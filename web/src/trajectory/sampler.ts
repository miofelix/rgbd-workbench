export type Vec3 = readonly [number, number, number];
export type TrajectoryEasing = "linear" | "smoothstep" | "ease_in_out_cubic";
export type ProjectionMode = "perspective" | "orthographic";
export type TrajectoryType =
  | "orbit"
  | "elliptical_orbit"
  | "dolly"
  | "pan"
  | "lift"
  | "orbit_tilt"
  | "spiral"
  | "flyover"
  | "dolly_zoom"
  | "custom";

export interface CameraKeyframeV1 {
  time: number;
  position: Vec3;
  target: Vec3;
  up: Vec3;
  projection: ProjectionMode;
  fov: number;
  ortho_scale: number;
  easing: TrajectoryEasing;
}

export interface CameraPathV1 {
  schema_version: 1;
  frame: string;
  unit: "m" | "unitless";
  trajectory_type: TrajectoryType;
  target_source: "robust_center" | "roi_center" | "selected_point" | "manual";
  target: Vec3;
  duration: number;
  fps: number;
  easing: TrajectoryEasing;
  loop_mode: "once" | "loop";
  projection: ProjectionMode;
  fov: number;
  ortho_scale: number;
  parameters: Record<string, number>;
  keyframes: readonly CameraKeyframeV1[];
  sampler_version: string;
}

export interface CameraPose {
  time: number;
  position: Vec3;
  target: Vec3;
  up: Vec3;
  projection: ProjectionMode;
  fov: number;
  ortho_scale: number;
}

const EPSILON = 1e-9;

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function scale(value: Vec3, amount: number): Vec3 {
  return [value[0] * amount, value[1] * amount, value[2] * amount];
}

function lerp(left: Vec3, right: Vec3, amount: number): Vec3 {
  return add(left, scale(subtract(right, left), amount));
}

function length(value: Vec3): number {
  return Math.sqrt(value[0] ** 2 + value[1] ** 2 + value[2] ** 2);
}

function normalize(value: Vec3): Vec3 {
  const magnitude = length(value);
  if (magnitude <= EPSILON) throw new Error("camera up vector cannot be zero");
  return scale(value, 1 / magnitude);
}

function eased(amount: number, easing: TrajectoryEasing): number {
  const clamped = Math.min(1, Math.max(0, amount));
  if (easing === "linear") return clamped;
  if (easing === "smoothstep") return clamped * clamped * (3 - 2 * clamped);
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

function parameter(path: CameraPathV1, name: string, fallback: number): number {
  const value = path.parameters[name] ?? fallback;
  return finite(value, `trajectory parameter ${name}`);
}

function presetPose(
  path: CameraPathV1,
  phase: number,
  time: number,
): CameraPose {
  const target = path.target;
  const theta =
    parameter(path, "start_angle", 0) +
    2 * Math.PI * parameter(path, "turns", 1) * phase;
  const radius = parameter(path, "radius", 1);
  if (radius <= 0) throw new Error("trajectory radius must be positive");
  const elevation = parameter(path, "elevation", 0);
  let position: Vec3;
  switch (path.trajectory_type) {
    case "orbit":
    case "orbit_tilt":
      position = [
        target[0] + Math.cos(theta) * radius,
        target[1] + elevation,
        target[2] + Math.sin(theta) * radius,
      ];
      break;
    case "elliptical_orbit": {
      const radiusX = parameter(path, "radius_x", radius);
      const radiusZ = parameter(path, "radius_z", radius);
      if (radiusX <= 0 || radiusZ <= 0)
        throw new Error("elliptical orbit radii must be positive");
      position = [
        target[0] + Math.cos(theta) * radiusX,
        target[1] + elevation,
        target[2] + Math.sin(theta) * radiusZ,
      ];
      break;
    }
    case "dolly":
    case "dolly_zoom": {
      const startDistance = parameter(path, "start_distance", radius);
      const endDistance = parameter(path, "end_distance", radius * 0.5);
      const distance = startDistance + (endDistance - startDistance) * phase;
      if (distance <= 0) throw new Error("dolly distances must be positive");
      const direction = normalize([
        parameter(path, "direction_x", 0),
        parameter(path, "direction_y", 0),
        parameter(path, "direction_z", 1),
      ]);
      position = subtract(target, scale(direction, distance));
      break;
    }
    case "pan":
      position = add(target, [
        parameter(path, "start_x", -radius) + 2 * radius * phase,
        elevation,
        parameter(path, "distance", radius),
      ]);
      break;
    case "lift":
      position = add(target, [
        parameter(path, "distance", radius),
        parameter(path, "start_y", -radius) + 2 * radius * phase,
        0,
      ]);
      break;
    case "spiral": {
      const startRadius = parameter(path, "start_radius", radius);
      const endRadius = parameter(path, "end_radius", radius * 2);
      const currentRadius = startRadius + (endRadius - startRadius) * phase;
      position = [
        target[0] + Math.cos(theta) * currentRadius,
        target[1] + parameter(path, "start_y", -radius) + 2 * radius * phase,
        target[2] + Math.sin(theta) * currentRadius,
      ];
      break;
    }
    case "flyover":
      position = lerp(
        [
          parameter(path, "start_x", target[0] - radius),
          parameter(path, "start_y", target[1]),
          parameter(path, "start_z", target[2] - radius),
        ],
        [
          parameter(path, "end_x", target[0] + radius),
          parameter(path, "end_y", target[1]),
          parameter(path, "end_z", target[2] + radius),
        ],
        phase,
      );
      break;
    default:
      throw new Error(`unsupported preset trajectory: ${path.trajectory_type}`);
  }
  let fov = path.fov;
  if (path.trajectory_type === "dolly_zoom") {
    const startFov = parameter(path, "start_fov", path.fov);
    fov = startFov + (parameter(path, "end_fov", path.fov) - startFov) * phase;
  }
  return {
    time,
    position,
    target,
    up: [0, -1, 0],
    projection: path.projection,
    fov,
    ortho_scale: path.ortho_scale,
  };
}

function centripetalPoint(
  points: readonly [Vec3, Vec3, Vec3, Vec3],
  amount: number,
): Vec3 {
  const [p0, p1, p2, p3] = points;
  const t1 = length(subtract(p1, p0)) ** 0.5;
  const t2 = t1 + length(subtract(p2, p1)) ** 0.5;
  const t3 = t2 + length(subtract(p3, p2)) ** 0.5;
  if (t2 - t1 <= EPSILON) return lerp(p1, p2, amount);
  const t = t1 + (t2 - t1) * amount;
  const blend = (
    left: Vec3,
    right: Vec3,
    leftTime: number,
    rightTime: number,
  ): Vec3 =>
    rightTime - leftTime <= EPSILON
      ? right
      : lerp(left, right, (t - leftTime) / (rightTime - leftTime));
  const a1 = blend(p0, p1, 0, t1);
  const a2 = blend(p1, p2, t1, t2);
  const a3 = blend(p2, p3, t2, t3);
  const b1 = blend(a1, a2, 0, t2);
  const b2 = blend(a2, a3, t1, t3);
  return blend(b1, b2, t1, t2);
}

function customPose(path: CameraPathV1, time: number): CameraPose {
  const keyframes = path.keyframes;
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (time <= first.time || time >= last.time) {
    const keyframe = time <= first.time ? first : last;
    return {
      time,
      position: keyframe.position,
      target: keyframe.target,
      up: normalize(keyframe.up),
      projection: keyframe.projection,
      fov: keyframe.fov,
      ortho_scale: keyframe.ortho_scale,
    };
  }
  const segment = keyframes.findIndex(
    (keyframe, index) =>
      index < keyframes.length - 1 && time <= keyframes[index + 1].time,
  );
  const left = keyframes[segment];
  const right = keyframes[segment + 1];
  const amount = eased(
    (time - left.time) / (right.time - left.time),
    left.easing,
  );
  let position: Vec3;
  let target: Vec3;
  if (keyframes.length === 2) {
    position = lerp(left.position, right.position, amount);
    target = lerp(left.target, right.target, amount);
  } else {
    const previous = keyframes[Math.max(0, segment - 1)];
    const next = keyframes[Math.min(keyframes.length - 1, segment + 2)];
    position = centripetalPoint(
      [previous.position, left.position, right.position, next.position],
      amount,
    );
    target = centripetalPoint(
      [previous.target, left.target, right.target, next.target],
      amount,
    );
  }
  return {
    time,
    position,
    target,
    up: normalize(lerp(left.up, right.up, amount)),
    projection: amount < 0.5 ? left.projection : right.projection,
    fov: left.fov + (right.fov - left.fov) * amount,
    ortho_scale:
      left.ortho_scale + (right.ortho_scale - left.ortho_scale) * amount,
  };
}

export function frameCount(duration: number, fps: number): number {
  finite(duration, "duration");
  if (duration <= 0) throw new Error("duration must be finite and positive");
  if (!Number.isSafeInteger(fps) || fps <= 0)
    throw new Error("fps must be a positive integer");
  return Math.max(2, Math.floor(duration * fps + 0.5));
}

export function sampleCameraPath(path: CameraPathV1): CameraPose[] {
  if (path.trajectory_type === "custom" && path.keyframes.length < 2)
    throw new Error("custom camera paths require at least two keyframes");
  const count = frameCount(path.duration, path.fps);
  const poses: CameraPose[] = [];
  for (let index = 0; index < count; index += 1) {
    const phase =
      path.loop_mode === "loop" ? index / count : index / (count - 1);
    const time = phase * path.duration;
    poses.push(
      path.trajectory_type === "custom"
        ? customPose(path, time)
        : presetPose(path, eased(phase, path.easing), time),
    );
  }
  return poses;
}
