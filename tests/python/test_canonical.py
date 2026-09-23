from __future__ import annotations

import hashlib

import pytest

from rgbd_workbench.domain.canonical import (
    canonical_json_bytes,
    derivation_key,
    scene_hash,
    sha256_bytes,
)
from rgbd_workbench.domain.contracts import (
    AlignmentSpec,
    CameraSpec,
    DepthSpec,
    ProcessingSpecV1,
    SceneManifestV1,
    SourceRef,
)


def metric_manifest() -> SceneManifestV1:
    def source(role: str) -> SourceRef:
        return SourceRef(
            role=role,
            source_id=f"{role}-1",
            filename=f"{role}.png",
            sha256="a" * 64,
            size_bytes=48,
            width=4,
            height=3,
        )

    return SceneManifestV1(
        schema_version=1,
        scene_id="scene-1",
        display_name="Scene 1",
        rgb=source("rgb"),
        depth=source("depth"),
        depth_spec=DepthSpec(representation="z_depth", unit="mm"),
        camera=CameraSpec(
            model="pinhole",
            width=4,
            height=3,
            fx=100.0,
            fy=100.0,
            cx=2.0,
            cy=1.5,
            distortion_model="none",
        ),
        alignment=AlignmentSpec(state="registered_to_rgb"),
        frame_id="camera",
        coordinate_convention="x_right_y_down_z_forward",
        normalizer_version="1",
        adapter_versions={"rgb": "1", "depth": "1"},
    )


def test_canonical_json_sorts_keys_and_preserves_utf8():
    expected = b'{"a":2,"name":"\xe6\xb7\xb1\xe5\xba\xa6","z":1}'
    assert canonical_json_bytes({"z": 1, "name": "深度", "a": 2}) == expected


def test_canonical_json_rejects_nonfinite_numbers():
    with pytest.raises(ValueError, match="non-finite"):
        canonical_json_bytes({"depth": float("nan")})


def test_canonical_json_uses_rfc8785_number_serialization():
    assert canonical_json_bytes({"integer_float": 1.0, "small": 0.000001}) == (
        b'{"integer_float":1,"small":0.000001}'
    )


def test_sha256_uses_lowercase_hex():
    payload = b"rgbd"
    assert sha256_bytes(payload) == hashlib.sha256(payload).hexdigest()


def test_scene_hash_changes_with_source_or_semantic_metadata():
    base = metric_manifest()
    first = scene_hash({"rgb": "a" * 64, "depth": "b" * 64}, base, "1")
    different_source = scene_hash({"rgb": "c" * 64, "depth": "b" * 64}, base, "1")
    different_semantics = scene_hash(
        {"rgb": "a" * 64, "depth": "b" * 64},
        base.model_copy(update={"depth_spec": DepthSpec(representation="z_depth", unit="m")}),
        "1",
    )
    assert len(first) == 64
    assert first != different_source
    assert first != different_semantics


def test_derivation_key_changes_with_processing_parameters():
    scene = "d" * 64
    defaults = ProcessingSpecV1()
    clipped = ProcessingSpecV1(depth_min=0.2)
    assert derivation_key(scene, defaults, "1") != derivation_key(scene, clipped, "1")
