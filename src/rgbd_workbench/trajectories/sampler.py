from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Final, cast

from rgbd_workbench.domain.contracts import CameraPathV1

Vec3 = tuple[float, float, float]
_EPSILON: Final = 1e-9


@dataclass(frozen=True, slots=True)
class CameraPose:
    """One sampled camera pose in the source Scene frame."""

    time: float
    position: Vec3
    target: Vec3
    up: Vec3
    projection: str
    fov: float
    ortho_scale: float


def frame_count(duration: float, fps: int) -> int:
    """Return the deterministic number of output frames, always at least two."""
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("duration must be finite and positive")
    if not isinstance(fps, int) or fps <= 0:
        raise ValueError("fps must be a positive integer")
    return max(2, math.floor(duration * fps + 0.5))


def _add(left: Vec3, right: Vec3) -> Vec3:
    return cast(Vec3, tuple(left[index] + right[index] for index in range(3)))


def _subtract(left: Vec3, right: Vec3) -> Vec3:
    return cast(Vec3, tuple(left[index] - right[index] for index in range(3)))


def _scale(value: Vec3, amount: float) -> Vec3:
    return cast(Vec3, tuple(component * amount for component in value))


def _lerp(left: Vec3, right: Vec3, amount: float) -> Vec3:
    return _add(left, _scale(_subtract(right, left), amount))


def _length(value: Vec3) -> float:
    return math.sqrt(sum(component * component for component in value))


def _normalize(value: Vec3) -> Vec3:
    length = _length(value)
    if length <= _EPSILON:
        raise ValueError("camera up vector cannot be zero")
    return _scale(value, 1.0 / length)


def _eased(amount: float, easing: str) -> float:
    amount = min(1.0, max(0.0, amount))
    if easing == "linear":
        return amount
    if easing == "smoothstep":
        return amount * amount * (3.0 - 2.0 * amount)
    if easing == "ease_in_out_cubic":
        return 4.0 * amount**3 if amount < 0.5 else 1.0 - ((-2.0 * amount + 2.0) ** 3) / 2.0
    raise ValueError(f"unsupported easing: {easing}")


def _parameter(path: CameraPathV1, name: str, default: float) -> float:
    value = path.parameters.get(name, default)
    if not math.isfinite(float(value)):
        raise ValueError(f"trajectory parameter {name} must be finite")
    return float(value)


def _preset_pose(path: CameraPathV1, phase: float, time: float) -> CameraPose:
    target = cast(Vec3, tuple(float(value) for value in path.target))
    theta_start = _parameter(path, "start_angle", 0.0)
    turns = _parameter(path, "turns", 1.0)
    theta = theta_start + 2.0 * math.pi * turns * phase
    radius = _parameter(path, "radius", 1.0)
    if radius <= 0:
        raise ValueError("trajectory radius must be positive")
    elevation = _parameter(path, "elevation", 0.0)
    if path.trajectory_type in {"orbit", "orbit_tilt"}:
        position = (
            target[0] + math.cos(theta) * radius,
            target[1] + elevation,
            target[2] + math.sin(theta) * radius,
        )
    elif path.trajectory_type == "elliptical_orbit":
        radius_x = _parameter(path, "radius_x", radius)
        radius_z = _parameter(path, "radius_z", radius)
        if radius_x <= 0 or radius_z <= 0:
            raise ValueError("elliptical orbit radii must be positive")
        position = (
            target[0] + math.cos(theta) * radius_x,
            target[1] + elevation,
            target[2] + math.sin(theta) * radius_z,
        )
    elif path.trajectory_type in {"dolly", "dolly_zoom"}:
        start_distance = _parameter(path, "start_distance", radius)
        end_distance = _parameter(path, "end_distance", radius * 0.5)
        distance = start_distance + (end_distance - start_distance) * phase
        if distance <= 0:
            raise ValueError("dolly distances must be positive")
        direction = _normalize(
            (
                _parameter(path, "direction_x", 0.0),
                _parameter(path, "direction_y", 0.0),
                _parameter(path, "direction_z", 1.0),
            )
        )
        position = _subtract(target, _scale(direction, distance))
    elif path.trajectory_type == "pan":
        position = _add(
            target,
            (
                _parameter(path, "start_x", -radius) + 2.0 * radius * phase,
                elevation,
                _parameter(path, "distance", radius),
            ),
        )
    elif path.trajectory_type == "lift":
        position = _add(
            target,
            (
                _parameter(path, "distance", radius),
                _parameter(path, "start_y", -radius) + 2.0 * radius * phase,
                0.0,
            ),
        )
    elif path.trajectory_type == "spiral":
        start_radius = _parameter(path, "start_radius", radius)
        end_radius = _parameter(path, "end_radius", radius * 2.0)
        position = (
            target[0] + math.cos(theta) * (start_radius + (end_radius - start_radius) * phase),
            target[1] + _parameter(path, "start_y", -radius) + 2.0 * radius * phase,
            target[2] + math.sin(theta) * (start_radius + (end_radius - start_radius) * phase),
        )
    elif path.trajectory_type == "flyover":
        start = (
            _parameter(path, "start_x", target[0] - radius),
            _parameter(path, "start_y", target[1]),
            _parameter(path, "start_z", target[2] - radius),
        )
        end = (
            _parameter(path, "end_x", target[0] + radius),
            _parameter(path, "end_y", target[1]),
            _parameter(path, "end_z", target[2] + radius),
        )
        position = _lerp(start, end, phase)
    else:
        raise ValueError(f"unsupported preset trajectory: {path.trajectory_type}")

    fov = path.fov
    if path.trajectory_type == "dolly_zoom":
        fov = (
            _parameter(path, "start_fov", path.fov)
            + (_parameter(path, "end_fov", path.fov) - _parameter(path, "start_fov", path.fov))
            * phase
        )
    up = (0.0, -1.0, 0.0)
    return CameraPose(
        time=time,
        position=position,
        target=target,
        up=up,
        projection=path.projection,
        fov=fov,
        ortho_scale=path.ortho_scale,
    )


def _centripetal_point(points: tuple[Vec3, Vec3, Vec3, Vec3], amount: float) -> Vec3:
    p0, p1, p2, p3 = points
    t1 = _length(_subtract(p1, p0)) ** 0.5
    t2 = t1 + _length(_subtract(p2, p1)) ** 0.5
    t3 = t2 + _length(_subtract(p3, p2)) ** 0.5
    if t2 - t1 <= _EPSILON:
        return _lerp(p1, p2, amount)
    t = t1 + (t2 - t1) * amount

    def blend(left: Vec3, right: Vec3, left_time: float, right_time: float) -> Vec3:
        if right_time - left_time <= _EPSILON:
            return right
        return _lerp(left, right, (t - left_time) / (right_time - left_time))

    a1 = blend(p0, p1, 0.0, t1)
    a2 = blend(p1, p2, t1, t2)
    a3 = blend(p2, p3, t2, t3)
    b1 = blend(a1, a2, 0.0, t2)
    b2 = blend(a2, a3, t1, t3)
    return blend(b1, b2, t1, t2)


def _custom_pose(path: CameraPathV1, time: float) -> CameraPose:
    keyframes = path.keyframes
    if time <= keyframes[0].time:
        keyframe = keyframes[0]
        return CameraPose(
            time,
            keyframe.position,
            keyframe.target,
            _normalize(keyframe.up),
            keyframe.projection,
            keyframe.fov,
            keyframe.ortho_scale,
        )
    if time >= keyframes[-1].time:
        keyframe = keyframes[-1]
        return CameraPose(
            time,
            keyframe.position,
            keyframe.target,
            _normalize(keyframe.up),
            keyframe.projection,
            keyframe.fov,
            keyframe.ortho_scale,
        )
    segment = next(
        index for index in range(len(keyframes) - 1) if time <= keyframes[index + 1].time
    )
    left = keyframes[segment]
    right = keyframes[segment + 1]
    amount = _eased((time - left.time) / (right.time - left.time), left.easing)
    if len(keyframes) == 2:
        position = _lerp(left.position, right.position, amount)
        target = _lerp(left.target, right.target, amount)
    else:
        p0 = keyframes[max(0, segment - 1)]
        p3 = keyframes[min(len(keyframes) - 1, segment + 2)]
        position = _centripetal_point(
            (p0.position, left.position, right.position, p3.position), amount
        )
        target = _centripetal_point((p0.target, left.target, right.target, p3.target), amount)
    up = _normalize(_lerp(left.up, right.up, amount))
    projection = left.projection if amount < 0.5 else right.projection
    return CameraPose(
        time=time,
        position=position,
        target=target,
        up=up,
        projection=projection,
        fov=left.fov + (right.fov - left.fov) * amount,
        ortho_scale=left.ortho_scale + (right.ortho_scale - left.ortho_scale) * amount,
    )


def sample_camera_path(path: CameraPathV1) -> tuple[CameraPose, ...]:
    """Sample a path with the contract's endpoint and loop semantics."""
    count = frame_count(float(path.duration), path.fps)
    if path.loop_mode == "loop":
        phases = (index / count for index in range(count))
    else:
        phases = (index / (count - 1) for index in range(count))
    poses: list[CameraPose] = []
    for phase in phases:
        time = phase * float(path.duration)
        if path.trajectory_type == "custom":
            pose = _custom_pose(path, time)
        else:
            pose = _preset_pose(path, _eased(phase, path.easing), time)
        poses.append(pose)
    return tuple(poses)
