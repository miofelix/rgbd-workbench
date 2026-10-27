import { describe, expect, it } from "vitest";
import { derivePointCloud } from "@/compute/pointcloud";
import { metricScene, rgbFixture, depthFixture } from "../fixtures/rgbd";
import { DEFAULT_PROCESSING } from "@/domain/processing";
import { encodePointCloud, parsePointCloud } from "@/domain/pointcloud-protocol";
import { defaultCameraPath } from "@/compute/trajectory/path";
import { renderCpuFrame } from "@/compute/render/cpu-renderer";
import { renderSpecSchema } from "@/domain/trajectory";
describe("authoritative CPU rendering", () => {
  it("renders a point and composes RGB/depth split layouts", async () => {
    const result = await derivePointCloud(
      metricScene(),
      rgbFixture(),
      depthFixture(),
      DEFAULT_PROCESSING,
    );
    const cloud = parsePointCloud(encodePointCloud(result.manifest, result.cloud));
    const path = defaultCameraPath([0, 0, 1], 2);
    const base = {
      format: "rgbd-workbench/render-spec" as const,
      schemaVersion: 2 as const,
      layout: "pointcloud" as const,
      width: 64,
      height: 64,
      fps: 30,
      codec: "png" as const,
      quality: "high" as const,
      background: "dark" as const,
      pointSize: 4,
      antiAlias: 1 as const,
      colorMode: "rgb" as const,
      colorMap: "turbo" as const,
      colorRange: { min: 0, max: 2 },
      maxPoints: 150_000,
      overlays: {
        axes: false,
        grid: false,
        title: false,
        unit: true,
        time: false,
        provenance: true,
      },
    };
    const render = renderSpecSchema.parse(base);
    const frame = renderCpuFrame(cloud, path, render, 0);
    expect(frame.length).toBe(64 * 64 * 3);
    expect([...frame].some((v, i) => i % 3 === 0 && v > 20)).toBe(true);
    const rgb = rgbFixture();
    const composite = renderCpuFrame(
      cloud,
      path,
      { ...render, layout: "rgb_depth_pointcloud" },
      0,
      {
        rgb: rgb.pixels,
        depthPreview: new Uint8Array(12),
        sourceWidth: 2,
        sourceHeight: 2,
        roi: null,
      },
    );
    expect(composite.length).toBe(frame.length);
    expect(composite).not.toEqual(frame);
  });
});
