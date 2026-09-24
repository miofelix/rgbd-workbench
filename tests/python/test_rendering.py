from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from rgbd_workbench.domain.contracts import RenderSpecV1
from rgbd_workbench.rendering import encode_png, render_pointcloud_frame
from rgbd_workbench.trajectories.sampler import CameraPose


def camera_pose(*, projection: str = "perspective") -> CameraPose:
    return CameraPose(
        time=0.0,
        position=(0.0, 0.0, 0.0),
        target=(0.0, 0.0, 1.0),
        up=(0.0, -1.0, 0.0),
        projection=projection,
        fov=90.0,
        ortho_scale=2.0,
    )


def render_spec(**overrides: object) -> RenderSpecV1:
    values: dict[str, object] = {
        "width": 8,
        "height": 8,
        "codec": "png_sequence",
        "point_size": 1.0,
        "background": (3, 5, 7),
    }
    values.update(overrides)
    return RenderSpecV1(**values)


def test_perspective_projection_and_z_buffer_are_deterministic():
    positions = np.asarray(
        [
            [0.0, 0.0, 1.0],
            [0.0, 0.0, 2.0],
            [0.5, 0.0, 1.0],
        ],
        dtype=np.float32,
    )
    colors = np.asarray([[220, 10, 10], [10, 10, 220], [10, 220, 10]], dtype=np.uint8)
    spec = render_spec()

    first = render_pointcloud_frame(positions, colors, camera_pose(), spec)
    second = render_pointcloud_frame(positions, colors, camera_pose(), spec)

    np.testing.assert_array_equal(first, second)
    np.testing.assert_array_equal(first[4, 4], [220, 10, 10])
    np.testing.assert_array_equal(first[4, 6], [10, 220, 10])
    np.testing.assert_array_equal(first[0, 0], [3, 5, 7])


def test_orthographic_projection_keeps_screen_position_independent_of_depth():
    positions = np.asarray([[0.5, 0.0, 1.0], [0.5, 0.0, 3.0]], dtype=np.float32)
    colors = np.asarray([[10, 220, 30], [220, 30, 10]], dtype=np.uint8)

    frame = render_pointcloud_frame(
        positions,
        colors,
        camera_pose(projection="orthographic"),
        render_spec(),
    )

    np.testing.assert_array_equal(frame[4, 6], [10, 220, 30])


def test_render_point_budget_uses_stable_source_order_sampling():
    positions = np.asarray(
        [[-0.7, 0.0, 1.0], [-0.35, 0.0, 1.0], [0.0, 0.0, 1.0], [0.35, 0.0, 1.0], [0.7, 0.0, 1.0]],
        dtype=np.float32,
    )
    colors = np.asarray(
        [[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0], [50, 0, 0]],
        dtype=np.uint8,
    )
    spec = render_spec(point_budget=100)
    limited = render_pointcloud_frame(
        positions,
        colors,
        camera_pose(),
        spec.model_copy(update={"point_budget": 3}),
    )
    repeated = render_pointcloud_frame(
        positions,
        colors,
        camera_pose(),
        spec.model_copy(update={"point_budget": 3}),
    )

    np.testing.assert_array_equal(limited, repeated)
    rendered_red = set(int(value) for value in limited[:, :, 0].ravel() if value >= 10)
    assert rendered_red == {10, 30, 50}


def test_invalid_arrays_and_degenerate_camera_are_rejected():
    positions = np.zeros((1, 3), dtype=np.float32)
    colors = np.zeros((1, 3), dtype=np.uint8)
    with pytest.raises(ValueError, match="finite"):
        render_pointcloud_frame(
            positions * np.nan,
            colors,
            camera_pose(),
            render_spec(),
        )
    with pytest.raises(ValueError, match="view direction"):
        render_pointcloud_frame(
            positions,
            colors,
            CameraPose(0.0, (0, 0, 0), (0, 0, 0), (0, -1, 0), "perspective", 45, 1),
            render_spec(),
        )


def test_png_encoder_returns_a_decodable_rgb_image():
    frame = np.full((3, 5, 3), 42, dtype=np.uint8)
    payload = encode_png(frame)

    assert payload.startswith(b"\x89PNG\r\n\x1a\n")
    with Image.open(io.BytesIO(payload)) as image:
        assert image.mode == "RGB"
        assert image.size == (5, 3)
        np.testing.assert_array_equal(np.asarray(image), frame)
