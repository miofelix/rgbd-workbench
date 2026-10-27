import type { CameraPose } from "@/domain/trajectory";
export interface ViewProjection {
  forward: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  tanHalfFov: number;
  aspect: number;
}
const normalize = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(...v);
  if (l < 1e-12) throw new Error("degenerate view");
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function viewProjection(pose: CameraPose, width: number, height: number): ViewProjection {
  const forward = normalize([
    pose.target[0] - pose.position[0],
    pose.target[1] - pose.position[1],
    pose.target[2] - pose.position[2],
  ]);
  const right = normalize(cross(forward, pose.up));
  const up = cross(right, forward);
  return {
    forward,
    right,
    up,
    tanHalfFov: Math.tan((pose.fov * Math.PI) / 360),
    aspect: width / height,
  };
}
export function projectPoint(
  position: [number, number, number],
  pose: CameraPose,
  vp: ViewProjection,
  width: number,
  height: number,
): { x: number; y: number; depth: number } | null {
  const delta: [number, number, number] = [
    position[0] - pose.position[0],
    position[1] - pose.position[1],
    position[2] - pose.position[2],
  ];
  const dot = (a: [number, number, number], b: [number, number, number]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const depth = dot(delta, vp.forward);
  if (depth <= 1e-6) return null;
  if (pose.projection === "perspective")
    return {
      x: ((dot(delta, vp.right) / (depth * vp.tanHalfFov * vp.aspect) + 1) * width) / 2,
      y: ((1 - dot(delta, vp.up) / (depth * vp.tanHalfFov)) * height) / 2,
      depth,
    };
  const scale = pose.orthoScale;
  return {
    x: ((dot(delta, vp.right) / (scale * vp.aspect) + 1) * width) / 2,
    y: ((1 - dot(delta, vp.up) / scale) * height) / 2,
    depth,
  };
}
