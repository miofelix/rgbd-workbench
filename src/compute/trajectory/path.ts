import { cameraPathSchema, type CameraPath, type CameraPose } from "@/domain/trajectory";
import type { Vector3 } from "@/domain/common";

const add = (a: Vector3, b: Vector3): Vector3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vector3, n: number): Vector3 => [a[0] * n, a[1] * n, a[2] * n];
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: Vector3, b: Vector3, t: number): Vector3 => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];
const length = (a: Vector3): number => Math.hypot(...a);
const normalize = (a: Vector3): Vector3 => {
  const l = length(a);
  if (!Number.isFinite(l) || l < 1e-9) throw new Error("degenerate camera vector");
  return scale(a, 1 / l);
};
function ease(value: number, kind: CameraPath["easing"]): number {
  if (kind === "smoothstep") return value * value * (3 - 2 * value);
  if (kind === "ease_in_out_cubic")
    return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
  return value;
}
export function frameCount(path: CameraPath, fps: number): number {
  const count = Math.round(path.duration * fps);
  if (!Number.isSafeInteger(count) || count < 2 || count > 7200)
    throw new RangeError("frame count must be between 2 and 7200");
  return count;
}
function preset(path: CameraPath, phase: number): CameraPose {
  const t = ease(phase, path.easing);
  const angle = t * Math.PI * 2 * path.turns;
  const height = Math.sin((path.elevation * Math.PI) / 180) * path.radius;
  const radial = Math.cos((path.elevation * Math.PI) / 180) * path.radius;
  let position: Vector3 = [
    path.target[0] + Math.cos(angle) * radial,
    path.target[1] + height,
    path.target[2] + Math.sin(angle) * radial,
  ];
  if (path.kind === "ellipse")
    position = add(path.target, [Math.cos(angle) * radial, height, Math.sin(angle) * radial * 0.5]);
  if (path.kind === "dolly" || path.kind === "dolly_zoom")
    position = add(path.target, [0, height, mix(path.radius, path.radius * path.distanceScale, t)]);
  if (path.kind === "truck")
    position = add(path.target, [mix(-path.radius, path.radius, t), height, path.radius]);
  if (path.kind === "tilt_pan")
    position = add(path.target, [
      Math.sin(angle) * radial * 0.15,
      height + Math.sin(angle * 0.5) * radial * 0.12,
      Math.cos(angle) * radial,
    ]);
  if (path.kind === "pedestal")
    position = add(path.target, [0, mix(-path.radius, path.radius, t), path.radius]);
  if (path.kind === "spiral")
    position = add(path.target, [
      Math.cos(angle) * radial * (1 - 0.65 * t),
      mix(height, height + path.radius * 0.5, t),
      Math.sin(angle) * radial * (1 - 0.65 * t),
    ]);
  if (path.kind === "flythrough")
    position = add(path.target, [
      Math.sin(angle) * radial * 0.15,
      height * 0.1,
      mix(path.radius, -path.radius * path.distanceScale, t),
    ]);
  let fov = path.projection.fov;
  if (path.kind === "dolly_zoom" && path.projection.projection === "perspective") {
    const distance = length(position);
    const startDistance = Math.hypot(path.radius, height);
    fov =
      (2 *
        Math.atan(
          (Math.tan(startDistance * 0 + (path.projection.fov * Math.PI) / 360) * distance) /
            startDistance,
        ) *
        180) /
      Math.PI;
    fov = Math.min(179, Math.max(1, fov));
  }
  return {
    position,
    target: path.target,
    up: [0, -1, 0],
    projection: path.projection.projection,
    fov,
    orthoScale: path.projection.orthoScale,
  };
}
function catmullRom(points: Vector3[], segment: number, t: number): Vector3 {
  const p1 = points[segment]!;
  const p2 = points[segment + 1]!;
  const p0 = points[Math.max(0, segment - 1)]!;
  const p3 = points[Math.min(points.length - 1, segment + 2)]!;
  const d = (a: Vector3, b: Vector3) => Math.sqrt(length([a[0] - b[0], a[1] - b[1], a[2] - b[2]]));
  const d01 = Math.max(d(p0, p1), 1e-9);
  const d12 = Math.max(d(p1, p2), 1e-9);
  const d23 = Math.max(d(p2, p3), 1e-9);
  // Barry–Goldman non-uniform interpolation; alpha=0.5 avoids cusps on uneven keys.
  const t0 = 0;
  const t1 = t0 + d01 ** 0.5;
  const t2 = t1 + d12 ** 0.5;
  const t3 = t2 + d23 ** 0.5;
  const time = mix(t1, t2, t);
  const lerp = (a: Vector3, b: Vector3, start: number, end: number): Vector3 =>
    mix3(a, b, (time - start) / Math.max(end - start, 1e-12));
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = mix3(a1, a2, (time - t0) / Math.max(t2 - t0, 1e-12));
  const b2 = mix3(a2, a3, (time - t1) / Math.max(t3 - t1, 1e-12));
  return mix3(b1, b2, (time - t1) / Math.max(t2 - t1, 1e-12));
}
function custom(path: CameraPath, seconds: number): CameraPose {
  const frames = path.keyframes;
  let segment = frames.findIndex(
    (frame, i) => i < frames.length - 1 && seconds <= frames[i + 1]!.time,
  );
  if (segment < 0) segment = frames.length - 2;
  const a = frames[segment]!;
  const b = frames[segment + 1]!;
  const t = ease(Math.min(1, Math.max(0, (seconds - a.time) / (b.time - a.time))), a.easing);
  const position =
    frames.length === 2
      ? mix3(a.position, b.position, t)
      : catmullRom(
          frames.map((f) => f.position),
          segment,
          t,
        );
  const target =
    frames.length === 2
      ? mix3(a.target, b.target, t)
      : catmullRom(
          frames.map((f) => f.target),
          segment,
          t,
        );
  return {
    position,
    target,
    up: normalize(mix3(a.up, b.up, t)),
    projection: a.projection,
    fov: mix(a.fov, b.fov, t),
    orthoScale: mix(a.orthoScale, b.orthoScale, t),
  };
}
export function sampleCameraPath(input: CameraPath, frame: number, fps: number): CameraPose {
  const path = cameraPathSchema.parse(input);
  const count = frameCount(path, fps);
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= count)
    throw new RangeError("frame is outside camera path");
  const phase = path.loopMode === "loop" ? frame / count : frame / (count - 1);
  const pose = path.kind === "custom" ? custom(path, phase * path.duration) : preset(path, phase);
  const forward = normalize([
    pose.target[0] - pose.position[0],
    pose.target[1] - pose.position[1],
    pose.target[2] - pose.position[2],
  ]);
  if (
    length(forward) < 1e-9 ||
    length([
      forward[1] * pose.up[2] - forward[2] * pose.up[1],
      forward[2] * pose.up[0] - forward[0] * pose.up[2],
      forward[0] * pose.up[1] - forward[1] * pose.up[0],
    ]) < 1e-7
  )
    throw new Error("camera view and up vectors are degenerate");
  return pose;
}
export function medianTarget(positions: Float32Array): Vector3 {
  if (positions.length < 3) throw new Error("point cloud is empty");
  return [0, 1, 2].map((axis) => {
    const values = Array.from(
      { length: positions.length / 3 },
      (_, i) => positions[i * 3 + axis]!,
    ).sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
  }) as Vector3;
}
export function defaultCameraPath(target: Vector3, radius: number): CameraPath {
  return cameraPathSchema.parse({
    format: "rgbd-workbench/camera-path",
    schemaVersion: 2,
    samplerVersion: "2.0.0",
    unit: "m",
    frameId: "camera",
    targetSource: { kind: "scene_median", pixelIndex: null },
    kind: "orbit",
    duration: 5,
    loopMode: "loop",
    target,
    radius,
    turns: 1,
    elevation: 20,
    distanceScale: 1,
    easing: "linear",
    projection: { projection: "perspective", fov: 45, orthoScale: radius },
    keyframes: [],
  });
}
