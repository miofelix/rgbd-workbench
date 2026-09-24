from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
from pydantic import ValidationError

from rgbd_workbench.domain.contracts import CameraKeyframeV1, CameraPathV1, RenderSpecV1
from rgbd_workbench.trajectories import frame_count, sample_camera_path

VECTOR_PATH = Path(__file__).parents[2] / "fixtures" / "m3" / "camera-path-vectors.json"


def orbit_path(**overrides: object) -> CameraPathV1:
    values: dict[str, object] = {
        "unit": "m",
        "trajectory_type": "orbit",
        "target": (0.0, 0.0, 0.0),
        "duration": 2.0,
        "fps": 4,
        "easing": "linear",
        "parameters": {"radius": 2.0, "turns": 1.0},
    }
    values.update(overrides)
    return CameraPathV1(**values)


def keyframe(time: float, x: float, z: float) -> CameraKeyframeV1:
    return CameraKeyframeV1(
        time=time,
        position=(x, 0.0, z),
        target=(0.0, 0.0, 0.0),
        up=(0.0, -1.0, 0.0),
        easing="linear",
    )


def test_frame_count_is_rounded_and_has_no_single_frame_case():
    assert frame_count(2.0, 4) == 8
    assert frame_count(0.01, 1) == 2


def test_once_path_includes_both_endpoints_and_loop_does_not_repeat_endpoint():
    once = sample_camera_path(orbit_path(loop_mode="once"))
    loop = sample_camera_path(orbit_path(loop_mode="loop"))

    assert len(once) == len(loop) == 8
    assert once[0].time == 0.0
    assert once[-1].time == 2.0
    assert loop[0].time == 0.0
    assert loop[-1].time < 2.0
    assert once[0].position == pytest.approx(once[-1].position)


def test_orbit_sampling_is_deterministic_and_uses_resolved_target():
    first = sample_camera_path(orbit_path())
    second = sample_camera_path(orbit_path())

    assert first == second
    assert first[0].target == (0.0, 0.0, 0.0)
    assert math.isclose(math.dist(first[0].position, first[0].target), 2.0)


def test_custom_path_interpolates_with_normalized_up_vector():
    path = CameraPathV1(
        unit="unitless",
        trajectory_type="custom",
        target_source="manual",
        target=(0.0, 0.0, 0.0),
        duration=2.0,
        fps=2,
        keyframes=[keyframe(0.0, 0.0, 2.0), keyframe(2.0, 2.0, 2.0)],
    )

    poses = sample_camera_path(path)

    assert len(poses) == 4
    assert poses[0].position == (0.0, 0.0, 2.0)
    assert poses[-1].position == (2.0, 0.0, 2.0)
    assert math.isclose(math.dist(poses[1].position, (0.0, 0.0, 2.0)), 2.0 / 3.0)
    assert math.isclose(math.dist(poses[1].up, (0.0, 0.0, 0.0)), 1.0)


def test_custom_loop_requires_matching_endpoints():
    with pytest.raises(ValidationError, match="matching endpoints"):
        CameraPathV1(
            unit="m",
            trajectory_type="custom",
            target=(0.0, 0.0, 0.0),
            duration=1.0,
            loop_mode="loop",
            keyframes=[keyframe(0.0, 0.0, 2.0), keyframe(1.0, 1.0, 2.0)],
        )


def test_degenerate_keyframe_and_invalid_render_ranges_are_rejected():
    with pytest.raises(ValidationError, match="degenerate"):
        CameraKeyframeV1(time=0.0, position=(0.0, 0.0, 0.0), target=(0.0, 0.0, 0.0))
    with pytest.raises(ValidationError, match="even"):
        RenderSpecV1(width=1279, height=720)


def test_render_spec_captures_path_snapshot_and_matching_timing():
    path = orbit_path()
    spec = RenderSpecV1(camera_path=path, fps=4, duration=2.0, codec="png_sequence")

    assert spec.point_budget == 150_000
    assert spec.camera_path == path

    with pytest.raises(ValidationError, match="fps"):
        RenderSpecV1(camera_path=path, fps=30, duration=2.0)


def test_shared_conformance_vectors_match_python_sampler():
    vectors = json.loads(VECTOR_PATH.read_text(encoding="utf-8"))
    for case in vectors["cases"]:
        payload = dict(case["path"])
        for field in ("target",):
            payload[field] = tuple(payload[field])
        payload["keyframes"] = [
            {
                **keyframe_payload,
                **{field: tuple(keyframe_payload[field]) for field in ("position", "target", "up")},
            }
            for keyframe_payload in payload["keyframes"]
        ]
        path = CameraPathV1.model_validate(payload)
        poses = sample_camera_path(path)
        assert len(poses) == case["frame_count"]
        assert poses[0].time == pytest.approx(case["first_time"])
        assert poses[-1].time == pytest.approx(case["last_time"])
        assert poses[0].position == pytest.approx(case["first_position"])
        assert poses[-1].position == pytest.approx(case["last_position"])
        if "middle_position" in case:
            assert poses[1].position == pytest.approx(case["middle_position"])
