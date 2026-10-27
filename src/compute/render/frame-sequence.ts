import type { PointCloudBuffer } from "@/domain/derivation";
import type { CameraPath, RenderSpec } from "@/domain/trajectory";
import { frameCount } from "../trajectory/path";
import { renderCpuFrame, type RenderSources } from "./cpu-renderer";
import { throwIfAborted } from "@/domain/diagnostics";
import { canonicalJsonBytes, sha256 } from "@/domain/identity";
import { createExportManifest } from "../export-manifest";
import { encodePng } from "../codecs/png";
import { writeZip } from "@/shared/zip";

export async function encodeFrameSequence(
  cloud: PointCloudBuffer,
  path: CameraPath,
  render: RenderSpec,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
  sources?: RenderSources,
): Promise<Blob> {
  const count = frameCount(path, render.fps);
  const frames: Record<string, Uint8Array> = {};
  for (let frame = 0; frame < count; frame += 1) {
    throwIfAborted(signal);
    const pixels = renderCpuFrame(cloud, path, render, frame, sources);
    frames[`frames/${String(frame).padStart(6, "0")}.png`] = new Uint8Array(
      encodePng(pixels, render.width, render.height),
    );
    onProgress?.((frame + 1) / count);
    await Promise.resolve();
  }
  frames["camera-path.json"] = canonicalJsonBytes(path);
  frames["render-spec.json"] = canonicalJsonBytes(render);
  const frameHashes = await Promise.all(
    Object.entries(frames)
      .filter(([name]) => name.endsWith(".png"))
      .map(async ([name, data]) => ({
        name,
        byteLength: data.byteLength,
        sha256: await sha256(data.slice().buffer),
      })),
  );
  const sequenceDigest = await sha256(canonicalJsonBytes(frameHashes));
  const sequenceBytes = Object.values(frames).reduce((sum, data) => sum + data.byteLength, 0);
  const manifest = await createExportManifest({
    sceneId: cloud.manifest.sceneId,
    derivation: cloud.manifest,
    cameraPath: path,
    render,
    frameCount: count,
    duration: count / render.fps,
    blob: new Blob([canonicalJsonBytes(frameHashes)], {
      type: "application/vnd.rgbd-workbench.frame-sequence",
    }),
    kind: "frames",
    encoder: "fast-png",
  });
  // Hash the ordered PNG sequence, not the ZIP containing the manifest itself.
  manifest.artifact.sha256 = sequenceDigest;
  manifest.artifact.byteLength = sequenceBytes;
  const payload = writeZip({ ...frames, "export-manifest.json": canonicalJsonBytes(manifest) });
  return new Blob([payload.buffer], { type: "application/zip" });
}
