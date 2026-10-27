import { exportManifestSchema, type ExportManifest } from "@/domain/export-manifest";
import { sha256 } from "@/domain/identity";
import { blobBytes } from "@/shared/binary";
export const RENDERER_VERSION = "2.0.0";
type Input = {
  sceneId: string;
  derivation: ExportManifest["derivation"];
  cameraPath: ExportManifest["cameraPath"];
  render: ExportManifest["render"];
  frameCount: number | null;
  duration: number | null;
  blob: Blob;
  kind: ExportManifest["artifact"]["kind"];
  encoder?: string | null;
};
export async function createExportManifest(input: Input): Promise<ExportManifest> {
  return exportManifestSchema.parse({
    format: "rgbd-workbench/export",
    schemaVersion: 2,
    exportId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    rendererVersion: RENDERER_VERSION,
    sceneId: input.sceneId,
    derivation: input.derivation,
    cameraPath: input.cameraPath,
    render: input.render,
    frameCount: input.frameCount,
    duration: input.duration,
    encoder: input.encoder ?? null,
    diagnostics: [],
    artifact: {
      kind: input.kind,
      mediaType: input.blob.type || "application/octet-stream",
      byteLength: input.blob.size,
      sha256: await sha256(await blobBytes(input.blob)),
    },
  });
}
