import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserLibrary } from "@/persistence/browser-library";
import { metricScene, rgbFixture, depthFixture, npyFloat32 } from "../fixtures/rgbd";
import { sha256, withSceneHash } from "@/domain/identity";
import { encodePng } from "@/compute/codecs/png";
import { importSourceArchive } from "@/persistence/archive";
import { unzipSync } from "fflate";
import { derivePointCloud } from "@/compute/pointcloud";
import { DEFAULT_PROCESSING } from "@/domain/processing";
import { encodePointCloud, parsePointCloud } from "@/domain/pointcloud-protocol";
import { depthPreview } from "@/compute/render/color-map";
import { blobBytes } from "@/shared/binary";

async function commit(
  library: BrowserLibrary,
  scene = metricScene(),
): Promise<ReturnType<typeof metricScene>> {
  const rgb = rgbFixture();
  const depth = depthFixture();
  const rgbBytes = encodePng(rgb.pixels, rgb.width, rgb.height);
  const depthBytes = npyFloat32([...depth.data], [depth.height, depth.width]).slice().buffer;
  const rgbBlob = new Blob([rgbBytes], { type: "image/png" });
  const depthBlob = new Blob([depthBytes]);
  scene = await withSceneHash({
    ...scene,
    name: "Metric Browser Fixture",
    sources: {
      rgb: {
        ...scene.sources.rgb,
        name: "rgb.png",
        byteLength: rgbBytes.byteLength,
        sha256: await sha256(rgbBytes),
        encoding: "png",
      },
      depth: {
        ...scene.sources.depth,
        name: "depth.npy",
        byteLength: depthBytes.byteLength,
        sha256: await sha256(depthBytes),
        encoding: "npy",
      },
    },
  });
  await library.commitScene(
    scene,
    { rgb: rgbBlob, depth: depthBlob },
    { rgb, depth, depthPreview: depthPreview(depth.data, depth.width, depth.height) },
  );
  return scene;
}
describe("versioned browser Library", () => {
  const libraries: BrowserLibrary[] = [];
  afterEach(() => {
    for (const library of libraries.splice(0)) library.close();
  });
  beforeEach(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("rgbd-workbench");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed"));
      request.onblocked = () => reject(new Error("IndexedDB delete blocked"));
    });
  });
  it("commits, restores and verifies raw sources", async () => {
    const library = new BrowserLibrary();
    libraries.push(library);
    const scene = await commit(library);
    expect((await library.listScenes())[0]?.sceneHash).toBe(scene.sceneHash);
    const sources = await library.readSources(scene.sceneId);
    expect(sources.previews.depth?.dataType).toBe("float32");
    const archive = await library.archive(scene.sceneId);
    const files = unzipSync(new Uint8Array(await blobBytes(archive)));
    expect(Object.keys(files)).toEqual([
      "archive.json",
      "scene.json",
      "sources/rgb",
      "sources/depth",
    ]);
    const restored = await importSourceArchive(archive, library);
    expect(restored.sceneHash).toBe(scene.sceneHash);
    expect(restored.sceneId).not.toBe(scene.sceneId);
    expect((await library.readSources(restored.sceneId)).previews.depth?.width).toBe(2);
  });
  it("rejects Archive source tampering", async () => {
    const library = new BrowserLibrary();
    libraries.push(library);
    const scene = await commit(library);
    const archive = await library.archive(scene.sceneId);
    const files = unzipSync(new Uint8Array(await blobBytes(archive)));
    files["sources/depth"] = new Uint8Array([1, 2, 3]);
    const { zipSync } = await import("fflate");
    await expect(
      importSourceArchive(new Blob([zipSync(files).slice().buffer]), library),
    ).rejects.toThrow(/Archive/);
  });
  it("validates derivation content and deletes scene-owned caches", async () => {
    const library = new BrowserLibrary();
    libraries.push(library);
    const scene = await commit(library);
    const result = await derivePointCloud(scene, rgbFixture(), depthFixture(), DEFAULT_PROCESSING);
    const payload = encodePointCloud(result.manifest, result.cloud);
    await library.putDerivation(result.manifest, new Blob([payload]));
    expect(
      (await library.getDerivation(scene.sceneId, result.manifest.derivationKey))?.manifest
        .pointCount,
    ).toBe(4);
    const damaged = payload.slice();
    const damageView = new DataView(damaged);
    damageView.setFloat32(result.manifest.arrays.positions.byteOffset, 99, true);
    await expect(library.putDerivation(result.manifest, new Blob([damaged]))).rejects.toThrow();
    await library.removeScene(scene.sceneId);
    expect(await library.getDerivation(scene.sceneId, result.manifest.derivationKey)).toBeNull();
  });
});

describe("Source Archive derivations", () => {
  it("round-trips validated derivation payloads with their Scene", async () => {
    const library = new BrowserLibrary();
    const scene = await commit(library);
    const result = await derivePointCloud(scene, rgbFixture(), depthFixture(), DEFAULT_PROCESSING);
    const payload = encodePointCloud(result.manifest, result.cloud);
    await library.putDerivation(result.manifest, new Blob([payload]));
    const archive = await library.archive(scene.sceneId, true);
    const files = unzipSync(new Uint8Array(await blobBytes(archive)));
    expect(files[`derivations/${result.manifest.derivationKey}.bin`]).toBeDefined();
    const restored = await importSourceArchive(archive, library);
    const cached = await library.getDerivation(restored.sceneId, result.manifest.derivationKey);
    expect(cached?.manifest.sceneId).toBe(restored.sceneId);
    expect(
      (await library.getDerivation(scene.sceneId, result.manifest.derivationKey))?.manifest.sceneId,
    ).toBe(scene.sceneId);
    const restoredCloud = parsePointCloud(await blobBytes(cached!.payload));
    expect(restoredCloud.manifest.sceneHash).toBe(result.manifest.sceneHash);
    expect([...restoredCloud.positions]).toEqual([...result.cloud.positions]);
    expect([...restoredCloud.colors]).toEqual([...result.cloud.colors]);
    expect([...restoredCloud.sourcePixelIndex]).toEqual([...result.cloud.pixels]);
    library.close();
  });
});
