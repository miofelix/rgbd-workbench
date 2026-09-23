from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from rgbd_workbench.adapters.base import NormalizedDepth
from rgbd_workbench.adapters.manifest import load_manifest_document
from rgbd_workbench.adapters.registry import AdapterRegistry
from rgbd_workbench.domain.contracts import (
    AlignmentSpec,
    CameraSpec,
    DepthSpec,
    SceneManifestV1,
    SourceRef,
)


def make_scene(
    depth_spec: DepthSpec | None = None,
    *,
    shape: tuple[int, int] = (2, 3),
) -> SceneManifestV1:
    height, width = shape

    def source(role: str) -> SourceRef:
        return SourceRef(
            role=role,
            source_id=f"{role}-1",
            filename=f"{role}.png",
            sha256="a" * 64,
            size_bytes=12,
            width=width,
            height=height,
        )

    return SceneManifestV1(
        schema_version=1,
        scene_id="scene-1",
        display_name="Fixture",
        rgb=source("rgb"),
        depth=source("depth"),
        depth_spec=depth_spec,
        camera=CameraSpec(
            model="pinhole",
            width=width,
            height=height,
            fx=10.0,
            fy=10.0,
            cx=width / 2,
            cy=height / 2,
            distortion_model="none",
        ),
        alignment=AlignmentSpec(state="registered_to_rgb"),
        normalizer_version="1",
        adapter_versions={"rgb": "1", "depth": "1"},
    )


def write_image(path: Path, mode: str, fmt: str) -> None:
    image = Image.new(mode, (3, 2))
    image.putdata(range(6) if mode == "L" else [(255, 0, 0)] * 6)
    image.save(path, format=fmt)


def write_pfm(path: Path, values: np.ndarray, scale: float = 1.0) -> None:
    flipped = np.flipud(values.astype("<f4"))
    with path.open("wb") as stream:
        stream.write(b"Pf\n")
        stream.write(f"{values.shape[1]} {values.shape[0]}\n".encode())
        stream.write(f"{-scale}\n".encode())
        stream.write(flipped.tobytes())


def test_rgb_probe_supports_common_containers_and_reports_shape(tmp_path: Path):
    registry = AdapterRegistry.default()
    for extension, fmt in (("png", "PNG"), ("jpg", "JPEG"), ("webp", "WEBP"), ("tiff", "TIFF")):
        path = tmp_path / f"rgb.{extension}"
        write_image(path, "RGB", fmt)
        candidate = registry.probe(path, "rgb")
        assert candidate.role == "rgb"
        assert candidate.metadata["width"] == 3
        assert candidate.metadata["height"] == 2
        assert candidate.metadata["channels"] == 3
        assert not any(item.severity == "fatal" for item in candidate.diagnostics)


def test_depth_probe_does_not_guess_units(tmp_path: Path):
    path = tmp_path / "depth.png"
    image = Image.fromarray(np.array([[1000, 2000], [0, 3000]], dtype=np.uint16), mode="I;16")
    image.save(path)

    candidate = AdapterRegistry.default().probe(path, "depth")
    assert candidate.metadata["dtype"] == "uint16"
    assert candidate.metadata["shape"] == [2, 2]
    assert candidate.metadata["unit"] is None
    assert any(item.code == "DEPTH_SEMANTICS_REQUIRED" for item in candidate.diagnostics)


@pytest.mark.parametrize("extension", ["npy", "npz"])
def test_numpy_depth_probe_rejects_object_and_multiple_arrays(tmp_path: Path, extension: str):
    registry = AdapterRegistry.default()
    if extension == "npy":
        object_path = tmp_path / "object.npy"
        np.save(object_path, np.array([{"x": 1}], dtype=object), allow_pickle=True)
        candidate = registry.probe(object_path, "depth")
        assert any(item.code == "DEPTH_OBJECT_DTYPE" for item in candidate.diagnostics)
    else:
        multi_path = tmp_path / "multi.npz"
        np.savez(multi_path, first=np.ones((2, 2)), second=np.ones((2, 2)))
        candidate = registry.probe(multi_path, "depth")
        assert any(item.code == "DEPTH_ARRAY_SELECTION_REQUIRED" for item in candidate.diagnostics)


def test_float_tiff_and_pfm_probe_shape_and_endianness(tmp_path: Path):
    tiff = tmp_path / "depth.tiff"
    Image.fromarray(np.array([[0.1, 0.2], [0.3, 0.4]], dtype=np.float32)).save(tiff)
    pfm = tmp_path / "depth.pfm"
    write_pfm(pfm, np.array([[0.1, 0.2], [0.3, 0.4]], dtype=np.float32))

    registry = AdapterRegistry.default()
    assert registry.probe(tiff, "depth").metadata["dtype"] == "float32"
    assert registry.probe(pfm, "depth").metadata["shape"] == [2, 2]


def test_raw_requires_manifest_shape_dtype_and_endianness(tmp_path: Path):
    raw = tmp_path / "depth.raw"
    raw.write_bytes(b"\x00\x01\x00\x02")
    candidate = AdapterRegistry.default().probe(raw, "depth")
    assert any(item.code == "RAW_DESCRIPTOR_REQUIRED" for item in candidate.diagnostics)


def test_manifest_loader_rejects_unsafe_yaml_and_oversized_document(tmp_path: Path):
    unsafe = tmp_path / "unsafe.yaml"
    unsafe.write_text("!!python/object/apply:os.system ['echo bad']", encoding="utf-8")
    with pytest.raises(ValueError, match="safe"):
        load_manifest_document(unsafe)

    huge = tmp_path / "huge.json"
    huge.write_text(json.dumps({"padding": "x" * (2 * 1024 * 1024)}), encoding="utf-8")
    with pytest.raises(ValueError, match="size"):
        load_manifest_document(huge, max_bytes=1024)


def test_registry_probes_manifest_role_without_exposing_path(tmp_path: Path):
    manifest_path = tmp_path / "scene.json"
    manifest_path.write_text(
        json.dumps({"schema_version": 1, "display_name": "Fixture"}),
        encoding="utf-8",
    )

    candidate = AdapterRegistry.default().probe(manifest_path, "manifest")

    assert candidate.role == "manifest"
    assert candidate.metadata["schema_version"] == 1
    assert any(item.code == "MANIFEST_SCHEMA_INCOMPLETE" for item in candidate.diagnostics)
    assert str(tmp_path) not in json.dumps([item.model_dump() for item in candidate.diagnostics])


def test_normalize_metric_millimeters_matches_invalid_before_scaling(tmp_path: Path):
    path = tmp_path / "depth.npy"
    np.save(path, np.array([[1000, 0], [2500, np.nan]], dtype=np.float32))
    registry = AdapterRegistry.default()
    candidate = registry.probe(path, "depth")
    normalized = registry.normalize(
        candidate,
        make_scene(DepthSpec(representation="z_depth", unit="mm"), shape=(2, 2)),
    )
    assert isinstance(normalized, NormalizedDepth)
    assert normalized.unit == "m"
    assert normalized.representation == "z_depth"
    assert normalized.values.flags.c_contiguous
    assert normalized.values.dtype == np.float32
    assert np.isclose(normalized.values[0, 0], 1.0)
    assert not normalized.valid[0, 1]
    assert not normalized.valid[1, 1]


def test_normalize_relative_pfm_is_unitless_and_does_not_enable_metric(tmp_path: Path):
    path = tmp_path / "relative.pfm"
    write_pfm(path, np.array([[0.2, 0.0], [0.8, np.nan]], dtype=np.float32))
    candidate = AdapterRegistry.default().probe(path, "depth")
    normalized = AdapterRegistry.default().normalize(
        candidate,
        make_scene(DepthSpec(representation="relative_z", unit="unitless"), shape=(2, 2)),
    )
    assert normalized.unit == "unitless"
    assert normalized.representation == "relative_z"
    assert normalized.valid.tolist() == [[True, False], [True, False]]


def test_normalize_rejects_shape_mismatch_and_missing_semantics(tmp_path: Path):
    path = tmp_path / "depth.npy"
    np.save(path, np.ones((4, 4), dtype=np.float32))
    candidate = AdapterRegistry.default().probe(path, "depth")
    with pytest.raises(ValueError, match="shape"):
        AdapterRegistry.default().normalize(
            candidate,
            make_scene(DepthSpec(representation="z_depth", unit="m"), shape=(2, 2)),
        )

    missing = make_scene(None, shape=(4, 4))
    with pytest.raises(ValueError, match="semantics"):
        AdapterRegistry.default().normalize(candidate, missing)


def test_diagnostics_do_not_expose_absolute_paths(tmp_path: Path):
    path = tmp_path / "unknown.depth"
    path.write_bytes(b"not a supported format")
    candidate = AdapterRegistry.default().probe(path, "depth")
    serialized = json.dumps([item.model_dump() for item in candidate.diagnostics])
    assert str(tmp_path) not in serialized
