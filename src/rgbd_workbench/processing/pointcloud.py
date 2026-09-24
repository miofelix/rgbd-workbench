from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Literal

import numpy as np
from scipy.spatial import cKDTree  # type: ignore[import-untyped]

from rgbd_workbench.adapters.base import NormalizedDepth
from rgbd_workbench.domain.contracts import (
    BoundsV1,
    ProcessingSpecV1,
    SceneManifestV1,
    capability_report,
)
from rgbd_workbench.domain.diagnostics import Diagnostic

PointUnit = Literal["m", "unitless"]
PointRepresentation = Literal["z_depth", "relative_z"]
_MAX_NEIGHBOR_WORK_ITEMS = 16_000_000
_MAX_NEIGHBOR_QUERY_ITEMS_PER_BATCH = 262_144


class PointCloudProcessingError(ValueError):
    """A derivation failure with diagnostics safe for API presentation."""

    def __init__(self, diagnostics: tuple[Diagnostic, ...] | list[Diagnostic]):
        self.diagnostics = tuple(diagnostics)
        super().__init__(
            self.diagnostics[0].message if self.diagnostics else "point-cloud processing failed"
        )


@dataclass(frozen=True, slots=True)
class PointCloudResult:
    positions: np.ndarray
    colors: np.ndarray
    pixel_index: np.ndarray
    unit: PointUnit
    representation: PointRepresentation
    source_shape: tuple[int, int]
    frame: str
    bounds: BoundsV1
    diagnostics: tuple[Diagnostic, ...] = ()

    @property
    def point_count(self) -> int:
        return int(self.positions.shape[0])


def _fatal(code: str, message: str, hint: str, capability: str | None) -> PointCloudProcessingError:
    return PointCloudProcessingError(
        [
            Diagnostic(
                code=code,
                severity="fatal",
                field="processing",
                message=message,
                hint=hint,
                capability=capability,
            )
        ]
    )


def _validate_inputs(
    scene: SceneManifestV1,
    rgb: np.ndarray,
    depth: NormalizedDepth,
) -> tuple[PointRepresentation, PointUnit]:
    if scene.depth_spec is None:
        raise _fatal(
            "DERIVATION_CAPABILITY_BLOCKED",
            "Depth semantics are required before point-cloud processing.",
            "Confirm the depth representation and unit in the import flow.",
            "relative_pointcloud",
        )
    representation = scene.depth_spec.representation
    if representation not in {"z_depth", "relative_z"} or depth.representation != representation:
        raise _fatal(
            "DERIVATION_REPRESENTATION_UNSUPPORTED",
            "This depth representation is not supported by the point-cloud processor.",
            "Use z_depth or relative_z for M2 point-cloud processing.",
            "metric_pointcloud",
        )
    unit: PointUnit = "m" if representation == "z_depth" else "unitless"
    capability = "metric_pointcloud" if unit == "m" else "relative_pointcloud"
    report = capability_report(scene, [])
    if not getattr(report, capability):
        raise _fatal(
            "DERIVATION_CAPABILITY_BLOCKED",
            "Scene geometry metadata does not satisfy the point-cloud contract.",
            "Provide matching pinhole intrinsics, registered alignment, and an undistorted source.",
            capability,
        )
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise _fatal(
            "RGB_SHAPE_INVALID",
            "RGB source must be an H x W x 3 image.",
            "Use an RGB image with three color channels.",
            capability,
        )
    if depth.values.ndim != 2 or depth.valid.shape != depth.values.shape:
        raise _fatal(
            "DEPTH_SHAPE_INVALID",
            "Normalized depth must be a two-dimensional array with a matching validity mask.",
            "Re-import the depth source as a numeric two-dimensional array.",
            capability,
        )
    if tuple(rgb.shape[:2]) != tuple(depth.values.shape):
        raise _fatal(
            "RGB_DEPTH_SIZE_MISMATCH",
            "RGB and depth dimensions do not match.",
            "Use already registered, equal-size RGB and depth inputs.",
            capability,
        )
    return representation, unit


def _neighbor_query_width(count: int, k: int, *, include_self: bool) -> int:
    if count <= 1:
        return 0
    requested = min(max(1, k), count if include_self else count - 1)
    return min(count, requested + (0 if include_self else 1))


def validate_neighbor_work_budget(point_count: int, processing: ProcessingSpecV1) -> None:
    filter_width = (
        _neighbor_query_width(point_count, processing.knn_filter.k, include_self=False)
        if processing.knn_filter is not None and point_count > 2
        else 0
    )
    smooth_width = (
        _neighbor_query_width(point_count, processing.knn_smooth.k, include_self=True)
        if processing.knn_smooth is not None and point_count > 1
        else 0
    )
    work_items = point_count * (filter_width + smooth_width)
    if work_items > _MAX_NEIGHBOR_WORK_ITEMS:
        raise PointCloudProcessingError(
            [
                Diagnostic(
                    code="DERIVATION_RESOURCE_LIMIT",
                    severity="fatal",
                    field="processing.knn",
                    message="The requested neighbor processing exceeds the memory/work budget.",
                    hint="Reduce max points or the KNN neighborhood sizes, then try again.",
                    capability=None,
                )
            ]
        )


def _ordered_neighbor_batches(
    points: np.ndarray,
    k: int,
    *,
    include_self: bool,
) -> Iterator[tuple[int, int, np.ndarray, np.ndarray]]:
    count = points.shape[0]
    if count <= 1:
        return
    requested = min(max(1, k), count if include_self else count - 1)
    query_width = _neighbor_query_width(count, k, include_self=include_self)
    batch_size = max(1, _MAX_NEIGHBOR_QUERY_ITEMS_PER_BATCH // query_width)
    query_points = points.astype(np.float64, copy=False)
    tree = cKDTree(query_points)
    for start in range(0, count, batch_size):
        end = min(count, start + batch_size)
        distances, indices = tree.query(query_points[start:end], k=query_width)
        if query_width == 1:
            distances = distances[:, None]
            indices = indices[:, None]
        ordered_distances = np.empty((end - start, requested), dtype=np.float64)
        ordered_indices = np.empty((end - start, requested), dtype=np.int64)
        for local_row in range(end - start):
            source_row = start + local_row
            pairs = sorted(
                (
                    (float(distance), int(index))
                    for distance, index in zip(
                        distances[local_row], indices[local_row], strict=True
                    )
                    if include_self or int(index) != source_row
                ),
                key=lambda item: (item[0], item[1]),
            )[:requested]
            ordered_distances[local_row] = [distance for distance, _ in pairs]
            ordered_indices[local_row] = [index for _, index in pairs]
        yield start, end, ordered_distances, ordered_indices


def _apply_voxel(
    positions: np.ndarray,
    colors: np.ndarray,
    pixel_index: np.ndarray,
    voxel_size: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    keys = np.floor(positions.astype(np.float64) / float(voxel_size)).astype(np.int64)
    order = np.lexsort((pixel_index, keys[:, 2], keys[:, 1], keys[:, 0]))
    sorted_keys = keys[order]
    sorted_positions = positions[order]
    sorted_colors = colors[order]
    sorted_pixels = pixel_index[order]
    starts = np.r_[0, 1 + np.flatnonzero(np.any(sorted_keys[1:] != sorted_keys[:-1], axis=1))]
    ends = np.r_[starts[1:], sorted_keys.shape[0]]
    grouped_positions = np.vstack(
        [sorted_positions[start:end].mean(axis=0) for start, end in zip(starts, ends, strict=True)]
    ).astype(np.float32)
    grouped_colors = (
        np.vstack(
            [
                np.rint(sorted_colors[start:end].mean(axis=0))
                for start, end in zip(starts, ends, strict=True)
            ]
        )
        .clip(0, 255)
        .astype(np.uint8)
    )
    grouped_pixels = np.asarray([sorted_pixels[start] for start in starts], dtype=np.uint32)
    stable_order = np.argsort(grouped_pixels, kind="stable")
    return (
        np.ascontiguousarray(grouped_positions[stable_order], dtype=np.float32),
        np.ascontiguousarray(grouped_colors[stable_order], dtype=np.uint8),
        np.ascontiguousarray(grouped_pixels[stable_order], dtype=np.uint32),
    )


def _apply_budget(
    positions: np.ndarray,
    colors: np.ndarray,
    pixel_index: np.ndarray,
    max_points: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if positions.shape[0] <= max_points:
        return positions, colors, pixel_index
    selected = np.floor(
        np.linspace(0, positions.shape[0] - 1, max_points, dtype=np.float64)
    ).astype(np.int64)
    selected = np.unique(selected)
    if selected.shape[0] != max_points:
        remaining = np.setdiff1d(np.arange(positions.shape[0]), selected, assume_unique=True)
        selected = np.sort(np.concatenate((selected, remaining[: max_points - selected.shape[0]])))
    return positions[selected], colors[selected], pixel_index[selected]


def _apply_knn_filter(
    positions: np.ndarray,
    colors: np.ndarray,
    pixel_index: np.ndarray,
    k: int,
    std_ratio: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if positions.shape[0] <= 2:
        return positions, colors, pixel_index
    mean = np.empty(positions.shape[0], dtype=np.float64)
    spread = np.empty(positions.shape[0], dtype=np.float64)
    for start, end, distances, _ in _ordered_neighbor_batches(positions, k, include_self=False):
        mean[start:end] = distances.mean(axis=1)
        spread[start:end] = distances.std(axis=1)
    keep = mean <= (mean.mean() + float(std_ratio) * max(float(spread.mean()), 1e-12))
    return positions[keep], colors[keep], pixel_index[keep]


def _apply_knn_smooth(
    positions: np.ndarray,
    colors: np.ndarray,
    pixel_index: np.ndarray,
    k: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    if positions.shape[0] <= 1:
        return positions, colors, pixel_index
    source = positions.astype(np.float64, copy=False)
    smoothed = np.empty_like(positions, dtype=np.float32)
    for start, end, _, neighbors in _ordered_neighbor_batches(positions, k, include_self=True):
        smoothed[start:end] = source[neighbors].mean(axis=1, dtype=np.float64)
    return np.ascontiguousarray(smoothed), colors, pixel_index


def build_derivation(
    scene: SceneManifestV1,
    rgb: np.ndarray,
    depth: NormalizedDepth,
    processing: ProcessingSpecV1,
) -> PointCloudResult:
    representation, unit = _validate_inputs(scene, rgb, depth)
    height, width = depth.values.shape
    camera = scene.camera
    assert camera is not None and camera.fx is not None and camera.fy is not None
    assert camera.cx is not None and camera.cy is not None
    diagnostics: list[Diagnostic] = []
    if processing.roi is None:
        x_min, y_min, x_max, y_max = 0, 0, width, height
    else:
        raw_x_min, raw_y_min, raw_x_max, raw_y_max = processing.roi
        x_min = max(0, min(width, raw_x_min))
        y_min = max(0, min(height, raw_y_min))
        x_max = max(0, min(width, raw_x_max))
        y_max = max(0, min(height, raw_y_max))
        if (x_min, y_min, x_max, y_max) != processing.roi:
            diagnostics.append(
                Diagnostic(
                    code="ROI_CLAMPED",
                    severity="warning",
                    field="processing.roi",
                    message="ROI was clamped to the source dimensions.",
                    hint="Keep ROI coordinates inside the source image.",
                    capability=None,
                )
            )
    if x_min >= x_max or y_min >= y_max:
        raise _fatal(
            "ROI_EMPTY",
            "The selected ROI contains no pixels.",
            "Choose a non-empty ROI inside the source dimensions.",
            "metric_pointcloud" if unit == "m" else "relative_pointcloud",
        )
    stride = processing.pixel_stride
    rows = np.arange(y_min, y_max, stride, dtype=np.int64)
    columns = np.arange(x_min, x_max, stride, dtype=np.int64)
    sampled_depth = depth.values[np.ix_(rows, columns)]
    sampled_valid = depth.valid[np.ix_(rows, columns)]
    yy, xx = np.meshgrid(rows, columns, indexing="ij")
    valid = sampled_valid & np.isfinite(sampled_depth) & (sampled_depth > 0)
    if processing.depth_min is not None:
        valid &= sampled_depth >= processing.depth_min
    if processing.depth_max is not None:
        valid &= sampled_depth <= processing.depth_max
    z = sampled_depth.astype(np.float32, copy=False)
    x = (xx.astype(np.float32) - np.float32(camera.cx)) * z / np.float32(camera.fx)
    y = (yy.astype(np.float32) - np.float32(camera.cy)) * z / np.float32(camera.fy)
    positions = np.stack((x, y, z), axis=-1)[valid]
    source_pixels = (yy[valid] * width + xx[valid]).astype(np.uint32)
    colors = np.asarray(rgb, dtype=np.uint8)[yy[valid], xx[valid]]
    if processing.xyz_min is not None:
        valid_xyz = np.all(positions >= np.asarray(processing.xyz_min, dtype=np.float32), axis=1)
        positions = positions[valid_xyz]
        colors = colors[valid_xyz]
        source_pixels = source_pixels[valid_xyz]
    if processing.xyz_max is not None:
        valid_xyz = np.all(positions <= np.asarray(processing.xyz_max, dtype=np.float32), axis=1)
        positions = positions[valid_xyz]
        colors = colors[valid_xyz]
        source_pixels = source_pixels[valid_xyz]
    if positions.shape[0] == 0:
        raise _fatal(
            "POINTCLOUD_EMPTY",
            "No valid points remain after the selected processing parameters.",
            "Relax the ROI, depth range, or XYZ range.",
            "metric_pointcloud" if unit == "m" else "relative_pointcloud",
        )
    if processing.voxel_size is not None:
        positions, colors, source_pixels = _apply_voxel(
            positions, colors, source_pixels, processing.voxel_size
        )
    positions, colors, source_pixels = _apply_budget(
        positions, colors, source_pixels, processing.max_points
    )
    validate_neighbor_work_budget(positions.shape[0], processing)
    if processing.knn_filter is not None:
        positions, colors, source_pixels = _apply_knn_filter(
            positions,
            colors,
            source_pixels,
            processing.knn_filter.k,
            processing.knn_filter.std_ratio,
        )
    if processing.knn_smooth is not None:
        positions, colors, source_pixels = _apply_knn_smooth(
            positions, colors, source_pixels, processing.knn_smooth.k
        )
    if positions.shape[0] == 0 or not np.isfinite(positions).all():
        raise _fatal(
            "POINTCLOUD_EMPTY",
            "No finite points remain after processing.",
            "Relax the processing parameters and try again.",
            "metric_pointcloud" if unit == "m" else "relative_pointcloud",
        )
    lower = positions.min(axis=0)
    upper = positions.max(axis=0)
    bounds = BoundsV1(
        min=(float(lower[0]), float(lower[1]), float(lower[2])),
        max=(float(upper[0]), float(upper[1]), float(upper[2])),
    )
    return PointCloudResult(
        positions=np.ascontiguousarray(positions, dtype=np.float32),
        colors=np.ascontiguousarray(colors, dtype=np.uint8),
        pixel_index=np.ascontiguousarray(source_pixels, dtype=np.uint32),
        unit=unit,
        representation=representation,
        source_shape=(height, width),
        frame=scene.frame_id,
        bounds=bounds,
        diagnostics=tuple(diagnostics),
    )
