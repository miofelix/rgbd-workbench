from __future__ import annotations

import numpy as np
import pytest

from rgbd_workbench.adapters.base import NormalizedDepth
from rgbd_workbench.domain.contracts import (
    AlignmentSpec,
    CameraSpec,
    DepthSpec,
    ProcessingSpecV1,
    SceneManifestV1,
    SourceRef,
)
from rgbd_workbench.processing.pointcloud import PointCloudProcessingError, build_derivation


def scene(*, representation: str = "z_depth", unit: str = "m") -> SceneManifestV1:
    def source(role: str) -> SourceRef:
        return SourceRef(
            role=role,
            source_id=f"{role}-1",
            filename=f"{role}.png",
            sha256="a" * 64,
            size_bytes=12,
            width=2,
            height=2,
        )

    return SceneManifestV1(
        schema_version=1,
        scene_id="scene-1",
        display_name="Fixture",
        rgb=source("rgb"),
        depth=source("depth"),
        depth_spec=DepthSpec(representation=representation, unit=unit),
        camera=CameraSpec(
            model="pinhole",
            width=2,
            height=2,
            fx=10.0,
            fy=10.0,
            cx=1.0,
            cy=1.0,
            distortion_model="none",
        ),
        alignment=AlignmentSpec(state="registered_to_rgb"),
        normalizer_version="1",
        adapter_versions={"rgb": "1", "depth": "1"},
    )


def rgb_fixture() -> np.ndarray:
    return np.array(
        [
            [[10, 20, 30], [40, 50, 60]],
            [[70, 80, 90], [100, 110, 120]],
        ],
        dtype=np.uint8,
    )


def normalized(values: list[list[float]], *, representation: str = "z_depth") -> NormalizedDepth:
    array = np.asarray(values, dtype=np.float32)
    valid = np.isfinite(array) & (array > 0)
    return NormalizedDepth(
        values=np.ascontiguousarray(np.where(valid, array, 0), dtype=np.float32),
        valid=np.ascontiguousarray(valid, dtype=bool),
        representation=representation,  # type: ignore[arg-type]
        unit="m" if representation == "z_depth" else "unitless",
        source_shape=(array.shape[0], array.shape[1]),
    )


def test_pinhole_projection_keeps_source_pixel_order():
    result = build_derivation(
        scene(), rgb_fixture(), normalized([[1, 2], [3, 4]]), ProcessingSpecV1()
    )

    np.testing.assert_allclose(result.positions[0], [-0.1, -0.1, 1.0])
    np.testing.assert_allclose(result.positions[1], [0.0, -0.2, 2.0])
    np.testing.assert_array_equal(result.pixel_index, [0, 1, 2, 3])
    assert result.positions.dtype == np.float32
    assert result.colors.dtype == np.uint8
    assert result.pixel_index.dtype == np.uint32


def test_invalid_depth_is_removed_before_projection():
    result = build_derivation(
        scene(), rgb_fixture(), normalized([[1, 0], [np.nan, 4]]), ProcessingSpecV1()
    )

    np.testing.assert_array_equal(result.pixel_index, [0, 3])
    assert result.positions.shape == (2, 3)


def test_relative_points_remain_unitless():
    result = build_derivation(
        scene(representation="relative_z", unit="unitless"),
        rgb_fixture(),
        normalized([[1, 2], [3, 4]], representation="relative_z"),
        ProcessingSpecV1(),
    )

    assert result.unit == "unitless"
    assert result.representation == "relative_z"


def test_roi_stride_and_depth_clip_are_applied_in_source_order():
    result = build_derivation(
        scene(),
        rgb_fixture(),
        normalized([[1, 2], [3, 4]]),
        ProcessingSpecV1(roi=(0, 0, 2, 2), pixel_stride=1, depth_min=2.0),
    )

    np.testing.assert_array_equal(result.pixel_index, [1, 2, 3])


def test_out_of_bounds_roi_is_clamped_with_warning():
    result = build_derivation(
        scene(),
        rgb_fixture(),
        normalized([[1, 2], [3, 4]]),
        ProcessingSpecV1(roi=(-4, -2, 4, 4)),
    )

    assert any(item.code == "ROI_CLAMPED" for item in result.diagnostics)
    assert result.point_count == 4


def test_voxel_and_budget_sampling_are_deterministic():
    spec = ProcessingSpecV1(voxel_size=10.0, max_points=100)
    first = build_derivation(scene(), rgb_fixture(), normalized([[1, 2], [3, 4]]), spec)
    second = build_derivation(scene(), rgb_fixture(), normalized([[1, 2], [3, 4]]), spec)

    np.testing.assert_array_equal(first.pixel_index, second.pixel_index)
    np.testing.assert_array_equal(first.positions, second.positions)


def test_knn_filter_and_smooth_handle_small_point_sets():
    spec = ProcessingSpecV1(
        knn_filter={"k": 16, "std_ratio": 2.0},
        knn_smooth={"k": 16},
    )
    result = build_derivation(scene(), rgb_fixture(), normalized([[1, 2], [3, 4]]), spec)

    assert result.point_count == 4
    assert np.isfinite(result.positions).all()


def test_empty_result_raises_structured_diagnostic():
    with pytest.raises(PointCloudProcessingError) as error:
        build_derivation(
            scene(),
            rgb_fixture(),
            normalized([[1, 2], [3, 4]]),
            ProcessingSpecV1(depth_min=10.0),
        )

    assert error.value.diagnostics[0].code == "POINTCLOUD_EMPTY"
