import { describe, expect, it } from "vitest";
import { defaultCameraPath, frameCount, sampleCameraPath } from "@/compute/trajectory/path";
import { trajectoryWarnings } from "@/compute/trajectory/validation";
import { ExportJobState } from "@/compute/export-job";
import { renderSpecSchema } from "@/domain/trajectory";
import { DEFAULT_PROCESSING } from "@/domain/processing";
import { COLOR_MAPS, sampleColorMap } from "@/compute/render/color-map";

const render = renderSpecSchema.parse({
  format: "rgbd-workbench/render-spec",
  schemaVersion: 2,
  layout: "pointcloud",
  width: 320,
  height: 240,
  fps: 30,
  codec: "avc",
  quality: "high",
  background: "dark",
  pointSize: 2,
  antiAlias: 1,
  colorMode: "depth",
  colorMap: "viridis",
  colorRange: { min: 0.5, max: 3 },
  maxPoints: 150_000,
  overlays: { axes: false, grid: false, title: false, unit: true, time: false, provenance: true },
});
const manifest = {
  format: "rgbd-workbench/derivation" as const,
  schemaVersion: 2 as const,
  derivationKey: "a".repeat(64),
  sceneId: "550e8400-e29b-41d4-a716-446655440000",
  sceneHash: "b".repeat(64),
  processorVersion: "2.0.0",
  processing: DEFAULT_PROCESSING,
  pointCount: 1,
  sourceShape: [2, 2] as [number, number],
  frameId: "camera",
  unit: "m" as const,
  representation: "z_depth" as const,
  bounds: {
    min: [0, 0, 1] as [number, number, number],
    max: [0, 0, 1] as [number, number, number],
  },
  arrays: {
    positions: { dataType: "float32" as const, shape: [1, 3], byteOffset: 0, byteLength: 12 },
    colors: { dataType: "uint8" as const, shape: [1, 3], byteOffset: 0, byteLength: 3 },
    sourcePixelIndex: { dataType: "uint32" as const, shape: [1], byteOffset: 0, byteLength: 4 },
  },
};
describe("M3 contracts and job lifecycle", () => {
  it("supports tilt/pan, finite custom keyframes, and rejects a noncontinuous custom loop", () => {
    const path = defaultCameraPath([0, 0, 0], 2);
    expect(
      Number.isFinite(sampleCameraPath({ ...path, kind: "tilt_pan" }, 0, 30).position[0]),
    ).toBe(true);
    const first = {
      time: 0,
      position: [0, 0, 3] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
      up: [0, -1, 0] as [number, number, number],
      projection: "perspective" as const,
      fov: 45,
      orthoScale: 2,
      easing: "smoothstep" as const,
    };
    const last = { ...first, time: 5, position: [2, 0, 3] as [number, number, number] };
    const custom = {
      ...path,
      kind: "custom" as const,
      loopMode: "loop" as const,
      keyframes: [first, last],
    };
    expect(trajectoryWarnings(custom, 30).some((message) => message.includes("不连续"))).toBe(true);
    expect(sampleCameraPath({ ...custom, loopMode: "once" }, 0, 30).position).toEqual(
      first.position,
    );
    expect(
      sampleCameraPath({ ...custom, loopMode: "once" }, frameCount(custom, 30) - 1, 30).position,
    ).toEqual(last.position);
  });
  it("freezes input and drives explicit export job transitions", () => {
    const path = defaultCameraPath([0, 0, 0], 2);
    const job = new ExportJobState({ cameraPath: path, render, derivation: manifest });
    expect(job.snapshot().status).toBe("queued");
    job.start();
    job.progress(0.5);
    expect(job.snapshot().progress).toBe(0.5);
    job.succeed();
    expect(job.snapshot().status).toBe("succeeded");
    expect(job.snapshot().completedAt).not.toBeNull();
    const cancelled = new ExportJobState({ cameraPath: path, render, derivation: manifest });
    cancelled.start();
    cancelled.cancel();
    cancelled.cancelled();
    expect(cancelled.snapshot().status).toBe("cancelled");
  });
  it("provides seven shared 256-entry color LUTs", () => {
    for (const [name, lut] of Object.entries(COLOR_MAPS)) {
      expect(lut.values.length).toBe(768);
      expect(sampleColorMap(name as keyof typeof COLOR_MAPS, 0.5)).toHaveLength(3);
    }
    expect(sampleColorMap("gray", 0)).toEqual([0, 0, 0]);
    expect(sampleColorMap("gray", 1)).toEqual([255, 255, 255]);
  });
});
