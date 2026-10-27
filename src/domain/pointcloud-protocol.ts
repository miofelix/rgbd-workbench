import { WorkbenchError, diagnostic } from "./diagnostics";
import { canonicalJsonBytes } from "./identity";
import {
  derivationManifestSchema,
  type DerivationManifest,
  type PointCloudBuffer,
} from "./derivation";
import type { CloudArrays } from "@/compute/pointcloud";

const MAGIC = new Uint8Array([82, 71, 66, 68, 80, 67, 50, 0]);
const PREFIX = 12;
const align4 = (n: number) => (n + 3) & ~3;
export function encodePointCloud(manifest: DerivationManifest, cloud: CloudArrays): ArrayBuffer {
  let cursor = 0;
  let header: Uint8Array;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    cursor = align4(cursor);
    const arrays = {
      positions: { ...manifest.arrays.positions, byteOffset: cursor },
      colors: {
        ...manifest.arrays.colors,
        byteOffset: align4(cursor + manifest.arrays.positions.byteLength),
      },
      sourcePixelIndex: {
        ...manifest.arrays.sourcePixelIndex,
        byteOffset: align4(
          cursor + manifest.arrays.positions.byteLength + manifest.arrays.colors.byteLength,
        ),
      },
    };
    const next = derivationManifestSchema.parse({ ...manifest, arrays });
    header = canonicalJsonBytes(next);
    const end = align4(PREFIX + header.byteLength);
    if (end === cursor) {
      const result = new Uint8Array(arrays.sourcePixelIndex.byteOffset + cloud.pixels.byteLength);
      result.set(MAGIC);
      new DataView(result.buffer).setUint32(8, header.byteLength, true);
      result.set(header, PREFIX);
      result.set(
        new Uint8Array(
          cloud.positions.buffer,
          cloud.positions.byteOffset,
          cloud.positions.byteLength,
        ),
        cursor,
      );
      result.set(
        new Uint8Array(cloud.colors.buffer, cloud.colors.byteOffset, cloud.colors.byteLength),
        arrays.colors.byteOffset,
      );
      result.set(
        new Uint8Array(cloud.pixels.buffer, cloud.pixels.byteOffset, cloud.pixels.byteLength),
        arrays.sourcePixelIndex.byteOffset,
      );
      parsePointCloud(result.buffer);
      return result.buffer;
    }
    cursor = end;
  }
  throw new Error("point-cloud header did not converge");
}
export function parsePointCloud(buffer: ArrayBuffer): PointCloudBuffer {
  if (buffer.byteLength < PREFIX) throw new Error("point-cloud payload is too short");
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (MAGIC.some((v, i) => data[i] !== v)) throw new Error("point-cloud magic is invalid");
  const length = view.getUint32(8, true);
  const start = PREFIX + length;
  if (start > buffer.byteLength || length > 4 * 1024 * 1024)
    throw new Error("point-cloud header length is invalid");
  let manifest: DerivationManifest;
  try {
    manifest = derivationManifestSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(PREFIX, start))),
    );
  } catch (cause) {
    throw new WorkbenchError(
      diagnostic("POINTCLOUD_PROTOCOL_INVALID", "fatal", "runtime.failure"),
      { cause },
    );
  }
  const payloadStart = align4(start);
  const descriptors = Object.values(manifest.arrays).sort((a, b) => a.byteOffset - b.byteOffset);
  let previousEnd = payloadStart;
  for (const descriptor of descriptors) {
    const itemSize = descriptor.dataType === "uint8" ? 1 : 4;
    const elements = descriptor.shape.reduce((a, b) => a * b, 1);
    if (
      !Number.isSafeInteger(elements) ||
      descriptor.byteLength !== elements * itemSize ||
      descriptor.byteOffset < previousEnd ||
      descriptor.byteOffset % 4 !== 0 ||
      descriptor.byteOffset + descriptor.byteLength > buffer.byteLength
    )
      throw new Error("point-cloud descriptor range is invalid");
    for (let i = previousEnd; i < descriptor.byteOffset; i += 1)
      if (data[i] !== 0) throw new Error("point-cloud padding is invalid");
    previousEnd = descriptor.byteOffset + descriptor.byteLength;
  }
  if (previousEnd !== buffer.byteLength) throw new Error("point-cloud total length mismatch");
  const { positions, colors, sourcePixelIndex } = manifest.arrays;
  return {
    manifest,
    positions: new Float32Array(buffer, positions.byteOffset, manifest.pointCount * 3),
    colors: new Uint8Array(buffer, colors.byteOffset, manifest.pointCount * 3),
    sourcePixelIndex: new Uint32Array(buffer, sourcePixelIndex.byteOffset, manifest.pointCount),
  };
}
export function stableLod(pointCount: number, maximum = 250_000): Uint32Array {
  if (
    !Number.isSafeInteger(pointCount) ||
    pointCount < 0 ||
    !Number.isSafeInteger(maximum) ||
    maximum <= 0
  )
    throw new RangeError("invalid LOD count");
  const count = Math.min(pointCount, maximum);
  const indices = new Uint32Array(count);
  if (count <= 1 || pointCount <= maximum) {
    for (let i = 0; i < count; i += 1) indices[i] = i;
    return indices;
  }
  for (let i = 0; i < count; i += 1) indices[i] = Math.floor((i * (pointCount - 1)) / (count - 1));
  return indices;
}
