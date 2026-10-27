import type { CameraPath, CameraPose, Keyframe } from "@/domain/trajectory";
import type { Vector3 } from "@/domain/common";
const near = (a: number, b: number, tolerance = 1e-6): boolean => Math.abs(a - b) <= tolerance;
const sameDirection = (a: Vector3, b: Vector3, tolerance: number): boolean => {
  const an = Math.hypot(...a);
  const bn = Math.hypot(...b);
  if (an < tolerance || bn < tolerance) return false;
  return Math.abs(a.reduce((sum, v, i) => sum + ((v / an) * b[i]!) / bn, 0) - 1) <= tolerance;
};
const sameVector = (a: Vector3, b: Vector3): boolean =>
  a.every((value, index) => near(value, b[index]!));
export function cameraPoseFromKeyframe(keyframe: Keyframe): CameraPose {
  const pose = {
    position: keyframe.position,
    target: keyframe.target,
    up: keyframe.up,
    projection: keyframe.projection,
    fov: keyframe.fov,
    orthoScale: keyframe.orthoScale,
  };
  return pose;
}
export function trajectoryWarnings(path: CameraPath, fps: number): string[] {
  const warnings: string[] = [];
  if (Math.round(path.duration * fps) < 2) warnings.push("轨迹至少需要两帧，请增加时长或 FPS。");
  if (path.kind === "custom" && path.keyframes.length >= 2) {
    const first = path.keyframes[0]!;
    const last = path.keyframes.at(-1)!;
    for (const keyframe of path.keyframes) {
      const forward = keyframe.target.map((v, i) => v - keyframe.position[i]!);
      const norm = Math.hypot(...forward);
      const upNorm = Math.hypot(...keyframe.up);
      if (norm < 1e-9 || upNorm < 1e-9)
        warnings.push(`关键帧 ${keyframe.time.toFixed(2)}s 的视线或 up 向量退化。`);
      else {
        const dot = forward.reduce((sum, v, i) => sum + ((v / norm) * keyframe.up[i]!) / upNorm, 0);
        if (Math.abs(dot) > 0.9999)
          warnings.push(`关键帧 ${keyframe.time.toFixed(2)}s 的视线与 up 接近共线。`);
      }
    }
    if (path.loopMode === "loop") {
      if (
        !sameVector(first.position, last.position) ||
        !sameVector(first.target, last.target) ||
        !sameVector(first.up, last.up) ||
        first.projection !== last.projection ||
        !near(first.fov, last.fov) ||
        !near(first.orthoScale, last.orthoScale)
      )
        warnings.push("自定义循环轨迹首尾姿态不连续，请改为 once 或统一首尾关键帧。");
      const before = path.keyframes.at(-2)!;
      const startDirection = first.position.map(
        (v, i) => v - path.keyframes[1]!.position[i]!,
      ) as Vector3;
      const endDirection = last.position.map((v, i) => v - before.position[i]!) as Vector3;
      if (!sameDirection(startDirection, endDirection, 1e-4))
        warnings.push("自定义循环轨迹首尾切线不连续，可能导致镜头跳变。");
    }
  }
  return [...new Set(warnings)];
}
