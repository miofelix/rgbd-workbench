import { canonicalJsonBytes, sha256 } from "@/domain/identity";
import type { DerivationManifest } from "@/domain/derivation";
import type { CloudArrays } from "./pointcloud";

export function encodePly(manifest: DerivationManifest, cloud: CloudArrays): Uint8Array {
  if (manifest.pointCount !== cloud.count) throw new Error("PLY manifest does not match cloud");
  const header = new TextEncoder().encode(
    [
      "ply",
      "format binary_little_endian 1.0",
      `comment frame ${manifest.frameId}`,
      `comment unit ${manifest.unit}`,
      `comment representation ${manifest.representation}`,
      `comment scene_hash ${manifest.sceneHash}`,
      `comment derivation_key ${manifest.derivationKey}`,
      `element vertex ${cloud.count}`,
      "property float x",
      "property float y",
      "property float z",
      "property uchar red",
      "property uchar green",
      "property uchar blue",
      "property uint source_pixel_index",
      "end_header",
      "",
    ].join("\n"),
  );
  const result = new Uint8Array(header.length + cloud.count * 16);
  result.set(header);
  const view = new DataView(result.buffer);
  for (let i = 0; i < cloud.count; i += 1) {
    const offset = header.length + i * 16;
    for (let c = 0; c < 3; c += 1) {
      view.setFloat32(offset + c * 4, cloud.positions[i * 3 + c]!, true);
      result[offset + 12 + c] = cloud.colors[i * 3 + c]!;
    }
    view.setUint32(offset + 12, cloud.pixels[i]!, true);
  }
  return result;
}
export function encodeParameters(manifest: DerivationManifest): Uint8Array {
  const json = canonicalJsonBytes(manifest);
  const result = new Uint8Array(json.length + 1);
  result.set(json);
  result.at(-1);
  result[json.length] = 10;
  return result;
}
export async function blobDigest(blob: Blob): Promise<string> {
  return sha256(await blob.arrayBuffer());
}
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|\p{Cc}]+/gu, "-")
      .slice(0, 120) || "rgbd-scene"
  );
}
