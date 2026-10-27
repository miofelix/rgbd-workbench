import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workbench } from "@/application/workbench";
import { MemoryLibrary } from "@/persistence/memory-library";
import { DEFAULT_PROCESSING } from "@/domain/processing";
import { metricScene } from "../fixtures/rgbd";
import type { Processor } from "@/application/contracts";
import { encodePointCloud } from "@/domain/pointcloud-protocol";

function cloud(scene: ReturnType<typeof metricScene>) {
  const manifest = {
    format: "rgbd-workbench/derivation" as const,
    schemaVersion: 2 as const,
    derivationKey: "c".repeat(64),
    sceneId: scene.sceneId,
    sceneHash: scene.sceneHash,
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
  const arrays = {
    positions: new Float32Array([0, 0, 1]),
    colors: new Uint8Array([255, 0, 0]),
    pixels: new Uint32Array([0]),
    count: 1,
  };
  return { manifest, arrays };
}
describe("Workbench use cases", () => {
  let scene: ReturnType<typeof metricScene>;
  let library: MemoryLibrary;
  beforeEach(async () => {
    scene = metricScene();
    library = new MemoryLibrary();
    await library.commitScene(
      scene,
      { rgb: new Blob(), depth: new Blob() },
      { rgb: { pixels: new Uint8Array(12), width: 2, height: 2 }, depth: null, depthPreview: null },
    );
  });
  it("returns validated cached derivations without recomputing", async () => {
    const derive = vi.fn(async () => {
      const result = cloud(scene);
      const { derivationKey } = await import("@/domain/identity");
      result.manifest.derivationKey = await derivationKey(
        scene.sceneHash,
        DEFAULT_PROCESSING,
        "2.0.0",
      );
      const payload = encodePointCloud(result.manifest, result.arrays);
      const { parsePointCloud } = await import("@/domain/pointcloud-protocol");
      return {
        manifest: result.manifest,
        cloud: parsePointCloud(payload),
        arrays: result.arrays,
        cached: false,
      };
    });
    const processor: Processor = {
      derive,
      prepare: vi.fn(),
      renderVideo: vi.fn(),
      dispose: vi.fn(),
    };
    const workbench = new Workbench(library, processor);
    const first = await workbench.derive(scene, DEFAULT_PROCESSING);
    const second = await workbench.derive(scene, DEFAULT_PROCESSING);
    expect(second.manifest.derivationKey).toBe(first.manifest.derivationKey);
    expect(derive).toHaveBeenCalledTimes(1);
    expect(
      (await library.getDerivation(first.manifest.sceneId, first.manifest.derivationKey))?.payload
        .size,
    ).toBeGreaterThan(0);
  });
  it("removes scene-owned caches", async () => {
    const result = cloud(scene);
    await library.putDerivation(result.manifest, new Blob());
    await library.removeScene(scene.sceneId);
    expect(library.scenes.size).toBe(0);
    expect(library.derivations.size).toBe(0);
  });
});
