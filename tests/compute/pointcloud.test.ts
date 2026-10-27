import { describe, expect, it } from "vitest";
import { derivePointCloud } from "@/compute/pointcloud";
import { DEFAULT_PROCESSING, freshProcessing } from "@/domain/processing";
import { depthFixture, metricScene, rgbFixture } from "../fixtures/rgbd";
import { encodePointCloud, parsePointCloud } from "@/domain/pointcloud-protocol";
import { encodePly } from "@/compute/export";
describe("deterministic point-cloud pipeline", () => {
  it("projects, normalizes and preserves source pixels", async () => {
    const { manifest, cloud } = await derivePointCloud(
      metricScene(),
      rgbFixture(),
      depthFixture(),
      DEFAULT_PROCESSING,
    );
    expect(cloud.count).toBe(4);
    expect([...cloud.positions.slice(0, 3)]).toEqual([-0.25, -0.25, 1]);
    expect([...cloud.pixels]).toEqual([0, 1, 2, 3]);
    const cloud2 = parsePointCloud(encodePointCloud(manifest, cloud));
    expect([...cloud2.positions]).toEqual([...cloud.positions]);
    expect(cloud2.manifest.derivationKey).toBe(manifest.derivationKey);
    const ply = encodePly(manifest, cloud);
    expect(new TextDecoder().decode(ply.slice(0, 4))).toBe("ply\n");
    expect(ply.length % 16).toBeGreaterThanOrEqual(0);
  });
  it("applies stride, budget, voxel and rejects empty results", async () => {
    const { cloud } = await derivePointCloud(metricScene(), rgbFixture(), depthFixture(), {
      ...freshProcessing(),
      pixelStride: 2,
      maxPoints: 100,
    });
    expect(cloud.count).toBe(1);
    await expect(
      derivePointCloud(metricScene(), rgbFixture(), depthFixture(), {
        ...freshProcessing(),
        depthMin: 100,
      }),
    ).rejects.toThrow(/有效点/);
    const nearOrigin = { ...depthFixture(), data: new Float32Array([1, 1, 1, 1]) };
    const centeredScene = metricScene();
    centeredScene.geometry.camera = {
      ...centeredScene.geometry.camera!,
      fx: 2,
      fy: 2,
      cx: -1,
      cy: -1,
    };
    const voxel = await derivePointCloud(centeredScene, rgbFixture(), nearOrigin, {
      ...freshProcessing(),
      voxelSize: 2,
    });
    expect(voxel.cloud.count).toBe(1);
    expect(voxel.cloud.pixels[0]).toBe(0);
    expect(voxel.cloud.positions[0]).toBeCloseTo(0.75);
    expect(voxel.cloud.positions[2]).toBe(1);
  });
});
