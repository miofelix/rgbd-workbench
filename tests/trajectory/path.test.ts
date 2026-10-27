import { describe, expect, it } from "vitest";
import { defaultCameraPath, frameCount, sampleCameraPath } from "@/compute/trajectory/path";
import { renderSpecSchema } from "@/domain/trajectory";
import { projectPoint, viewProjection } from "@/compute/render/projection";
describe("M3 camera path and projection", () => {
  it("does not duplicate loop endpoint and includes once endpoint", () => {
    const path = defaultCameraPath([0, 0, 0], 2);
    expect(frameCount(path, 10)).toBe(50);
    expect(
      sampleCameraPath({ ...path, duration: 5, loopMode: "once" }, 49, 10).position[0],
    ).toBeCloseTo(sampleCameraPath(path, 0, 10).position[0], 12);
    expect(
      sampleCameraPath({ ...path, duration: 5, loopMode: "once" }, 49, 10).position[1],
    ).toBeCloseTo(sampleCameraPath(path, 0, 10).position[1], 12);
    expect(
      sampleCameraPath({ ...path, duration: 5, loopMode: "once" }, 49, 10).position[2],
    ).toBeCloseTo(sampleCameraPath(path, 0, 10).position[2], 12);
    expect(sampleCameraPath(path, 50 - 1, 10).position).not.toEqual(
      sampleCameraPath(path, 0, 10).position,
    );
  });
  it("projects an on-axis point to the frame center", () => {
    const pose = sampleCameraPath(defaultCameraPath([0, 0, 0], 2), 0, 30);
    const projected = projectPoint([0, 0, 0], pose, viewProjection(pose, 100, 100), 100, 100);
    expect(projected?.x).toBeCloseTo(50);
    expect(projected?.y).toBeCloseTo(50);
  });
  it("validates even video sizes", () => {
    const input = {
      format: "rgbd-workbench/render-spec",
      schemaVersion: 2,
      layout: "pointcloud",
      width: 321,
      height: 240,
      fps: 30,
      codec: "avc",
      quality: "high",
      background: "dark",
      pointSize: 2,
      antiAlias: 1,
      colorMode: "rgb",
    };
    expect(renderSpecSchema.safeParse(input).success).toBe(false);
  });
});
