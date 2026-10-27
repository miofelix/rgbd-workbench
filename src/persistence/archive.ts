import { sceneSchema, type Scene } from "@/domain/scene";
import { encodePointCloud, parsePointCloud } from "@/domain/pointcloud-protocol";
import { sourceArchiveSchema } from "@/domain/source-archive";
import { sha256, withSceneHash } from "@/domain/identity";
import { WorkbenchError, diagnostic } from "@/domain/diagnostics";
import type { Library } from "@/application/contracts";
import { decodeRgb } from "@/compute/codecs/image";
import { decodeDepth } from "@/compute/codecs";
import { depthPreview } from "@/compute/render/color-map";
import { blobBytes } from "@/shared/binary";
import { readBoundedZip, SOURCE_ARCHIVE_BUDGET } from "@/shared/zip";

function invalid(cause?: unknown): WorkbenchError {
  return new WorkbenchError(
    diagnostic("ARCHIVE_INVALID", "fatal", "archive.invalid"),
    cause === undefined ? undefined : { cause },
  );
}
export async function importSourceArchive(blob: Blob, library: Library): Promise<Scene> {
  try {
    const files = readBoundedZip(
      await blobBytes(blob),
      SOURCE_ARCHIVE_BUDGET,
      (name) =>
        ["archive.json", "scene.json", "sources/rgb", "sources/depth", "manifests/source"].includes(
          name,
        ) || /^derivations\/[a-f0-9]{64}\.bin$/.test(name),
    );
    if (
      !files["archive.json"] ||
      !files["scene.json"] ||
      !files["sources/rgb"] ||
      !files["sources/depth"]
    )
      throw new Error("archive is incomplete");
    const index = sourceArchiveSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files["archive.json"])),
    );
    const stored = sceneSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files["scene.json"])),
    );
    const sourceBytes = { rgb: files["sources/rgb"], depth: files["sources/depth"] };
    for (const entry of index.entries) {
      const bytes = files[entry.path];
      if (
        !bytes ||
        entry.byteLength !== bytes.byteLength ||
        (await sha256(bytes.slice().buffer)) !== entry.sha256
      )
        throw new Error("archive index integrity failed");
    }
    for (const role of ["rgb", "depth"] as const) {
      const descriptor = stored.sources[role];
      const bytes = sourceBytes[role];
      if (
        descriptor.byteLength !== bytes.byteLength ||
        (await sha256(bytes.slice().buffer)) !== descriptor.sha256
      )
        throw new Error("archive source integrity failed");
    }
    const rgbFile = new File([sourceBytes.rgb.slice().buffer], stored.sources.rgb.name);
    const depthFile = new File([sourceBytes.depth.slice().buffer], stored.sources.depth.name);
    const [rgb, depth] = await Promise.all([
      decodeRgb(rgbFile),
      decodeDepth(depthFile, stored.geometry.rawDescriptor ?? undefined),
    ]);
    if (
      rgb.width !== stored.sources.rgb.width ||
      rgb.height !== stored.sources.rgb.height ||
      depth.width !== stored.sources.depth.width ||
      depth.height !== stored.sources.depth.height
    )
      throw new Error("archive raster shape mismatch");
    const scene = await withSceneHash({ ...stored, sceneId: crypto.randomUUID() });
    if (
      scene.sceneHash !== stored.sceneHash ||
      stored.sceneHash !== index.sceneSha256 ||
      stored.sceneId !== index.sceneId
    )
      throw new Error("archive Scene identity mismatch");
    await library.commitScene(
      scene,
      { rgb: rgbFile, depth: depthFile },
      { rgb, depth, depthPreview: depthPreview(depth.data, depth.width, depth.height) },
    );
    for (const [name, bytes] of Object.entries(files)) {
      const match = /^derivations\/([a-f0-9]{64})\.bin$/.exec(name);
      if (match) {
        const cloud = parsePointCloud(bytes.slice().buffer);
        if (
          cloud.manifest.sceneHash !== scene.sceneHash ||
          cloud.manifest.derivationKey !== match[1]
        )
          throw new Error("archive derivation identity mismatch");
        const rebound = { ...cloud.manifest, sceneId: scene.sceneId };
        const payload = encodePointCloud(rebound, {
          positions: cloud.positions,
          colors: cloud.colors,
          pixels: cloud.sourcePixelIndex,
          count: cloud.manifest.pointCount,
        });
        await library.putDerivation(
          rebound,
          new Blob([payload], { type: "application/vnd.rgbd-workbench.pointcloud-v2" }),
        );
      }
    }
    return scene;
  } catch (cause) {
    if (cause instanceof WorkbenchError) throw cause;
    throw invalid(cause);
  }
}
