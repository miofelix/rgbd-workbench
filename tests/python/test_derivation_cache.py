from __future__ import annotations

from io import BytesIO
from pathlib import Path

import numpy as np
import pytest

from rgbd_workbench.domain.contracts import (
    AlignmentSpec,
    ArrayDescriptorV1,
    BoundsV1,
    CameraSpec,
    DepthSpec,
    DerivationManifestV1,
    ProcessingSpecV1,
    SceneManifestV1,
    SourceRef,
)
from rgbd_workbench.processing.pointcloud import PointCloudResult
from rgbd_workbench.processing.protocol import (
    derivation_json,
    encode_ply,
    encode_pointcloud,
    manifest_for_result,
)
from rgbd_workbench.workspace.store import SceneSourceError, StagedFile, WorkspaceStore


def source_from_staged(role: str, staged: StagedFile) -> SourceRef:
    return SourceRef(
        role=role,
        source_id=staged.source_id,
        filename=staged.filename,
        sha256=staged.sha256,
        size_bytes=staged.size_bytes,
        width=1,
        height=1,
    )


def committed_store(tmp_path: Path) -> tuple[WorkspaceStore, SceneManifestV1]:
    store = WorkspaceStore(tmp_path / "workspace")
    store.initialize()
    rgb = store.stage_bytes("rgb.png", BytesIO(b"rgb-source"), max_bytes=100)
    depth = store.stage_bytes("depth.npy", BytesIO(b"depth-source"), max_bytes=100)
    manifest = SceneManifestV1(
        schema_version=1,
        scene_id="scene-1",
        display_name="Scene 1",
        rgb=source_from_staged("rgb", rgb),
        depth=source_from_staged("depth", depth),
        depth_spec=DepthSpec(representation="z_depth", unit="m"),
        camera=CameraSpec(
            model="pinhole",
            width=1,
            height=1,
            fx=10.0,
            fy=10.0,
            cx=0.0,
            cy=0.0,
            distortion_model="none",
        ),
        alignment=AlignmentSpec(state="registered_to_rgb"),
        normalizer_version="1",
        adapter_versions={"rgb": "1", "depth": "1"},
    )
    return store, store.commit_scene(manifest, {"rgb": rgb, "depth": depth})


def cache_files(scene_id: str, key: str) -> dict[str, bytes]:
    result = PointCloudResult(
        positions=np.array([[0.0, 0.0, 1.0]], dtype=np.float32),
        colors=np.array([[20, 40, 60]], dtype=np.uint8),
        pixel_index=np.array([0], dtype=np.uint32),
        unit="m",
        representation="z_depth",
        source_shape=(1, 1),
        frame="camera",
        bounds=BoundsV1(min=(0.0, 0.0, 1.0), max=(0.0, 0.0, 1.0)),
    )
    base = DerivationManifestV1(
        schema_version=1,
        derivation_id=f"derivation-{key}",
        scene_id=scene_id,
        scene_hash="b" * 64,
        derivation_key=key,
        processor_version="1",
        processing=ProcessingSpecV1(),
        point_count=1,
        source_shape=(1, 1),
        frame="camera",
        unit="m",
        representation="z_depth",
        bounds=result.bounds,
        arrays={
            "positions": ArrayDescriptorV1(dtype="float32", shape=(1, 3), offset=0, nbytes=12),
            "colors": ArrayDescriptorV1(dtype="uint8", shape=(1, 3), offset=12, nbytes=3),
            "pixel_index": ArrayDescriptorV1(dtype="uint32", shape=(1,), offset=16, nbytes=4),
        },
    )
    manifest = manifest_for_result(result, base)
    return {
        "manifest.json": derivation_json(manifest),
        "pointcloud.bin": encode_pointcloud(result, manifest),
        "pointcloud.ply": encode_ply(result, manifest),
        "parameters.json": derivation_json(manifest),
    }


def test_publish_derivation_is_atomic_and_readable(tmp_path: Path):
    store, _ = committed_store(tmp_path)
    files = cache_files("scene-1", "a" * 64)

    store.publish_derivation("scene-1", "a" * 64, files)
    cached = store.read_cached_derivation("scene-1", "a" * 64)

    assert cached is not None
    assert cached["pointcloud.bin"] == files["pointcloud.bin"]
    assert cached.manifest.derivation_key == "a" * 64


def test_changed_managed_source_invalidates_resolution(tmp_path: Path):
    store, scene = committed_store(tmp_path)
    source = store.resolve_scene_source("scene-1", "depth")
    source.write_bytes(b"changed")

    with pytest.raises(SceneSourceError, match="SCENE_SOURCE_STALE") as error:
        store.resolve_scene_source("scene-1", "depth")

    assert error.value.code == "SCENE_SOURCE_STALE"
    assert scene.depth.filename not in str(error.value)


def test_corrupt_binary_cache_is_removed_instead_of_reused(tmp_path: Path):
    store, _ = committed_store(tmp_path)
    key = "a" * 64
    store.publish_derivation("scene-1", key, cache_files("scene-1", key))
    binary = store.derivation_dir("scene-1", key) / "pointcloud.bin"
    binary.write_bytes(binary.read_bytes()[:-1])

    assert store.read_cached_derivation("scene-1", key) is None
    assert not store.derivation_dir("scene-1", key).exists()


def test_publish_rejects_manifest_for_another_key_without_partial_cache(tmp_path: Path):
    store, _ = committed_store(tmp_path)
    key = "a" * 64

    with pytest.raises(ValueError, match="derivation key"):
        store.publish_derivation("scene-1", key, cache_files("scene-1", "b" * 64))

    assert not store.derivation_dir("scene-1", key).exists()
    assert not list((store.paths.scenes / "scene-1").glob(".*.tmp"))


@pytest.mark.parametrize("key", ["../escape", "A" * 64, "abc"])
def test_derivation_key_cannot_escape_workspace(tmp_path: Path, key: str):
    store, _ = committed_store(tmp_path)
    with pytest.raises(ValueError, match="derivation key"):
        store.derivation_dir("scene-1", key)
