from __future__ import annotations

import io
import math
from typing import cast

import numpy as np
from numpy.typing import NDArray
from PIL import Image

from rgbd_workbench.domain.contracts import RenderSpecV1
from rgbd_workbench.trajectories.sampler import CameraPose

_EPSILON = 1e-9


FloatArray = NDArray[np.float64]
ByteArray = NDArray[np.uint8]
UIntArray = NDArray[np.uint32]


def _vector_length(vector: FloatArray) -> float:
    return float(np.sqrt(np.dot(vector, vector)))


def _unit(vector: FloatArray, label: str) -> FloatArray:
    length = _vector_length(vector)
    if length <= _EPSILON:
        raise ValueError(f"{label} must be non-zero")
    return vector / length


def _validate_arrays(
    positions: np.ndarray[tuple[int, int], np.dtype[np.floating]],
    colors: np.ndarray[tuple[int, int], np.dtype[np.uint8]],
    pixel_index: np.ndarray[tuple[int], np.dtype[np.uint32]] | None,
) -> tuple[FloatArray, ByteArray, UIntArray]:
    points = np.asarray(positions)
    rgb = np.asarray(colors)
    if points.ndim != 2 or points.shape[1] != 3:
        raise ValueError("positions must have shape (N, 3)")
    if rgb.shape != points.shape:
        raise ValueError("colors must have the same shape as positions")
    if not np.issubdtype(points.dtype, np.number) or not np.isfinite(points).all():
        raise ValueError("positions must contain only finite numbers")
    if rgb.dtype != np.uint8:
        raise ValueError("colors must use uint8 values")
    if pixel_index is None:
        source = cast(UIntArray, np.arange(points.shape[0], dtype=np.uint32))
    else:
        source = np.asarray(pixel_index)
        if source.ndim != 1 or source.shape[0] != points.shape[0]:
            raise ValueError("pixel_index must have shape (N,)")
        if source.dtype != np.uint32:
            raise ValueError("pixel_index must use uint32 values")
    return (
        np.ascontiguousarray(points, dtype=np.float64),
        np.ascontiguousarray(rgb, dtype=np.uint8),
        np.ascontiguousarray(source, dtype=np.uint32),
    )


def _camera_basis(pose: CameraPose) -> tuple[FloatArray, FloatArray, FloatArray]:
    position = np.asarray(pose.position, dtype=np.float64)
    target = np.asarray(pose.target, dtype=np.float64)
    up = np.asarray(pose.up, dtype=np.float64)
    forward = _unit(target - position, "camera view direction")
    right = _unit(cast(FloatArray, np.cross(forward, up)), "camera right direction")
    camera_up = _unit(cast(FloatArray, np.cross(right, forward)), "camera up direction")
    return position, right, camera_up


def _project(
    camera_points: FloatArray,
    pose: CameraPose,
    width: int,
    height: int,
) -> tuple[FloatArray, FloatArray, FloatArray]:
    z = camera_points[:, 2]
    aspect = width / height
    if pose.projection == "perspective":
        tangent = math.tan(math.radians(pose.fov) / 2.0)
        if tangent <= _EPSILON:
            raise ValueError("perspective fov must be between zero and 180 degrees")
        ndc_x = camera_points[:, 0] / (z * tangent * aspect)
        ndc_y = camera_points[:, 1] / (z * tangent)
    elif pose.projection == "orthographic":
        if pose.ortho_scale <= _EPSILON:
            raise ValueError("orthographic scale must be positive")
        ndc_x = camera_points[:, 0] / (pose.ortho_scale * aspect / 2.0)
        ndc_y = camera_points[:, 1] / (pose.ortho_scale / 2.0)
    else:
        raise ValueError(f"unsupported projection: {pose.projection}")
    screen_x = (ndc_x + 1.0) * 0.5 * width
    screen_y = (1.0 - ndc_y) * 0.5 * height
    return screen_x, screen_y, z


def _draw_point(
    image: ByteArray,
    depth: FloatArray,
    source: UIntArray,
    x: float,
    y: float,
    z: float,
    color: ByteArray,
    source_index: int,
    radius: int,
) -> None:
    center_x = int(math.floor(x))
    center_y = int(math.floor(y))
    min_x = max(0, center_x - radius)
    max_x = min(image.shape[1] - 1, center_x + radius)
    min_y = max(0, center_y - radius)
    max_y = min(image.shape[0] - 1, center_y + radius)
    for pixel_y in range(min_y, max_y + 1):
        for pixel_x in range(min_x, max_x + 1):
            if radius > 0 and (pixel_x - x) ** 2 + (pixel_y - y) ** 2 > radius**2:
                continue
            current_depth = depth[pixel_y, pixel_x]
            current_source = source[pixel_y, pixel_x]
            if z < current_depth or (z == current_depth and source_index < current_source):
                depth[pixel_y, pixel_x] = z
                source[pixel_y, pixel_x] = source_index
                image[pixel_y, pixel_x] = color


def _apply_point_budget(
    positions: FloatArray,
    colors: ByteArray,
    source: UIntArray,
    budget: int,
) -> tuple[FloatArray, ByteArray, UIntArray]:
    if positions.shape[0] <= budget:
        return positions, colors, source
    selected = np.floor(np.linspace(0, positions.shape[0] - 1, budget, dtype=np.float64)).astype(
        np.int64
    )
    return positions[selected], colors[selected], source[selected]


def render_pointcloud_frame(
    positions: np.ndarray[tuple[int, int], np.dtype[np.floating]],
    colors: np.ndarray[tuple[int, int], np.dtype[np.uint8]],
    pose: CameraPose,
    render: RenderSpecV1,
    *,
    pixel_index: np.ndarray[tuple[int], np.dtype[np.uint32]] | None = None,
) -> ByteArray:
    """Render one RGB frame from source-frame point-cloud arrays.

    The loop order and z-buffer tie-break are fixed so identical inputs produce
    byte-identical frames across retries and future render jobs.
    """
    points, rgb, source_pixels = _validate_arrays(positions, colors, pixel_index)
    points, rgb, source_pixels = _apply_point_budget(
        points,
        rgb,
        source_pixels,
        render.point_budget,
    )
    position, right, camera_up = _camera_basis(pose)
    forward = _unit(np.asarray(pose.target) - position, "camera view direction")
    camera_points = points - position
    camera_points = np.column_stack(
        (
            camera_points @ right,
            camera_points @ camera_up,
            camera_points @ forward,
        )
    )
    screen_x, screen_y, depth = _project(camera_points, pose, render.width, render.height)
    near = 1e-6
    far = max(near, 1e6)
    visible = (
        np.isfinite(screen_x)
        & np.isfinite(screen_y)
        & np.isfinite(depth)
        & (depth >= near)
        & (depth <= far)
        & (screen_x >= -render.point_size)
        & (screen_x < render.width + render.point_size)
        & (screen_y >= -render.point_size)
        & (screen_y < render.height + render.point_size)
    )
    image = np.empty((render.height, render.width, 3), dtype=np.uint8)
    image[:, :] = np.asarray(render.background, dtype=np.uint8)
    z_buffer = np.full((render.height, render.width), np.inf, dtype=np.float64)
    source_buffer = np.full((render.height, render.width), np.iinfo(np.uint32).max, dtype=np.uint32)
    radius = max(0, int(math.ceil(float(render.point_size) / 2.0)))
    for index in np.flatnonzero(visible):
        _draw_point(
            image,
            z_buffer,
            source_buffer,
            float(screen_x[index]),
            float(screen_y[index]),
            float(depth[index]),
            rgb[index],
            int(source_pixels[index]),
            radius,
        )
    return np.ascontiguousarray(image)


def encode_png(image: np.ndarray[tuple[int, int, int], np.dtype[np.uint8]]) -> bytes:
    """Encode one validated RGB frame as deterministic PNG bytes."""
    frame = np.asarray(image)
    if frame.ndim != 3 or frame.shape[2] != 3 or frame.dtype != np.uint8:
        raise ValueError("PNG frame must have shape (H, W, 3) and uint8 dtype")
    if frame.shape[0] <= 0 or frame.shape[1] <= 0:
        raise ValueError("PNG frame dimensions must be positive")
    output = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(frame), mode="RGB").save(
        output,
        format="PNG",
        optimize=False,
        compress_level=9,
    )
    return output.getvalue()
