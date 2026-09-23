from __future__ import annotations

import pytest
from pydantic import ValidationError

from rgbd_workbench.domain.contracts import (
    AlignmentSpec,
    CameraSpec,
    DepthSpec,
    ProcessingSpecV1,
    SceneManifestV1,
    SourceRef,
    capability_report,
)
from rgbd_workbench.domain.diagnostics import Diagnostic


def source(role: str, *, width: int = 4, height: int = 3) -> SourceRef:
    return SourceRef(
        role=role,
        source_id=f"{role}-1",
        filename=f"{role}.png",
        sha256="a" * 64,
        size_bytes=48,
        width=width,
        height=height,
    )


def manifest(**overrides: object) -> SceneManifestV1:
    values: dict[str, object] = {
        "schema_version": 1,
        "scene_id": "scene-1",
        "display_name": "Scene 1",
        "rgb": source("rgb"),
        "depth": source("depth"),
        "depth_spec": DepthSpec(representation="z_depth", unit="mm"),
        "camera": CameraSpec(
            model="pinhole",
            width=4,
            height=3,
            fx=100.0,
            fy=100.0,
            cx=2.0,
            cy=1.5,
            distortion_model="none",
        ),
        "alignment": AlignmentSpec(state="registered_to_rgb"),
        "frame_id": "camera",
        "coordinate_convention": "x_right_y_down_z_forward",
        "normalizer_version": "1",
        "adapter_versions": {"rgb": "1", "depth": "1"},
    }
    values.update(overrides)
    return SceneManifestV1.model_validate(values)


def test_metric_depth_requires_declared_unit_or_scale():
    with pytest.raises(ValidationError):
        DepthSpec(representation="z_depth")


def test_relative_depth_is_unitless_and_rejects_metric_scale():
    depth = DepthSpec(representation="relative_z", unit="unitless")
    assert depth.unit == "unitless"

    with pytest.raises(ValidationError):
        DepthSpec(representation="relative_z", unit="unitless", scale_to_meter=0.001)


@pytest.mark.parametrize("value", [0, -1, float("inf"), float("nan")])
def test_camera_rejects_nonpositive_or_nonfinite_focal_lengths(value: float):
    with pytest.raises(ValidationError):
        CameraSpec(
            model="pinhole",
            width=4,
            height=3,
            fx=value,
            fy=100.0,
            cx=2.0,
            cy=1.5,
            distortion_model="none",
        )


def test_models_reject_unknown_fields():
    with pytest.raises(ValidationError):
        DepthSpec(representation="z_depth", unit="m", guessed_unit="mm")


def test_metric_capability_requires_matching_registered_camera_geometry():
    report = capability_report(manifest(), [])
    assert report.metric_pointcloud is True
    assert report.relative_pointcloud is False

    mismatch = capability_report(
        manifest(alignment=AlignmentSpec(state="unknown")),
        [],
    )
    assert mismatch.metric_pointcloud is False

    wrong_size = capability_report(
        manifest(
            camera=CameraSpec(
                model="pinhole",
                width=5,
                height=3,
                fx=100.0,
                fy=100.0,
                cx=2.0,
                cy=1.5,
                distortion_model="none",
            )
        ),
        [],
    )
    assert wrong_size.metric_pointcloud is False


def test_relative_capability_never_enables_metric_measurement():
    relative = manifest(depth_spec=DepthSpec(representation="relative_z", unit="unitless"))
    report = capability_report(relative, [])
    assert report.relative_pointcloud is True
    assert report.metric_pointcloud is False


def test_processing_spec_has_explicit_safe_defaults():
    spec = ProcessingSpecV1()
    assert spec.pixel_stride == 1
    assert spec.max_points == 2_000_000
    assert spec.depth_min is None
    assert spec.knn_filter is None


def test_diagnostic_serializes_stable_fields():
    diagnostic = Diagnostic(
        code="DEPTH_UNIT_MISSING",
        severity="fatal",
        field="depth_spec.unit",
        message="Depth unit is required.",
        hint="Choose a unit or provide a scale.",
        capability="metric_pointcloud",
    )
    assert set(diagnostic.model_dump()) == {
        "code",
        "severity",
        "field",
        "message",
        "hint",
        "capability",
    }
