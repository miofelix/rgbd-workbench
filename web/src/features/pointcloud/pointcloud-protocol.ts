import type { ArrayDescriptor, DerivationManifest } from "../../api/types";

const MAGIC = new Uint8Array([82, 71, 66, 68, 80, 67, 49, 0]);
const PREFIX_BYTES = 12;
const itemSizes = { float32: 4, uint8: 1, uint32: 4 } as const;

export interface ParsedPointCloud {
  manifest: DerivationManifest;
  positions: Float32Array;
  colors: Uint8Array;
  pixelIndex: Uint32Array;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function shape(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error(`${label} shape is invalid`);
  return value.map((item, index) => {
    const dimension = integer(item, `${label}.shape[${index}]`);
    if (dimension === 0)
      throw new Error(`${label} shape dimensions must be positive`);
    return dimension;
  });
}

function descriptor(value: unknown, label: string): ArrayDescriptor {
  const source = record(value, label);
  const dtype = source.dtype;
  if (dtype !== "float32" && dtype !== "uint8" && dtype !== "uint32") {
    throw new Error(`${label} dtype is unsupported`);
  }
  const dimensions = shape(source.shape, label);
  const offset = integer(source.offset, `${label}.offset`);
  const nbytes = integer(source.nbytes, `${label}.nbytes`);
  const expectedBytes =
    dimensions.reduce((total, dimension) => total * dimension, 1) *
    itemSizes[dtype];
  if (nbytes !== expectedBytes)
    throw new Error(`${label} byte length is invalid`);
  return { dtype, shape: dimensions, offset, nbytes };
}

function sameShape(actual: number[], expected: number[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every((dimension, index) => dimension === expected[index])
  );
}

function validateManifest(value: unknown): DerivationManifest {
  const source = record(value, "point-cloud header");
  const pointCount = integer(source.point_count, "point_count");
  if (pointCount === 0) throw new Error("point_count must be positive");
  if (source.unit !== "m" && source.unit !== "unitless")
    throw new Error("unit is invalid");
  if (
    source.representation !== "z_depth" &&
    source.representation !== "relative_z"
  ) {
    throw new Error("representation is invalid");
  }
  const arrays = record(source.arrays, "arrays");
  const positions = descriptor(arrays.positions, "positions");
  const colors = descriptor(arrays.colors, "colors");
  const pixelIndex = descriptor(arrays.pixel_index, "pixel_index");
  if (
    positions.dtype !== "float32" ||
    !sameShape(positions.shape, [pointCount, 3])
  ) {
    throw new Error("positions descriptor is invalid");
  }
  if (colors.dtype !== "uint8" || !sameShape(colors.shape, [pointCount, 3])) {
    throw new Error("colors descriptor is invalid");
  }
  if (
    pixelIndex.dtype !== "uint32" ||
    !sameShape(pixelIndex.shape, [pointCount])
  ) {
    throw new Error("pixel_index descriptor is invalid");
  }
  return {
    ...(source as unknown as DerivationManifest),
    point_count: pointCount,
    arrays: { positions, colors, pixel_index: pixelIndex },
  };
}

export function parsePointCloudPayload(buffer: ArrayBuffer): ParsedPointCloud {
  if (buffer.byteLength < PREFIX_BYTES)
    throw new Error("point-cloud payload is too short");
  const bytes = new Uint8Array(buffer);
  if (!MAGIC.every((value, index) => bytes[index] === value)) {
    throw new Error("point-cloud magic is invalid");
  }
  const headerLength = new DataView(buffer).getUint32(8, true);
  const headerEnd = PREFIX_BYTES + headerLength;
  if (headerEnd > buffer.byteLength)
    throw new Error("point-cloud header exceeds payload length");
  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.slice(12, headerEnd),
      ),
    );
  } catch (cause) {
    throw new Error("point-cloud header is invalid", { cause });
  }
  const manifest = validateManifest(decoded);
  const payloadStart = (headerEnd + 3) & ~3;
  const ranges = Object.entries(manifest.arrays)
    .map(([name, item]) => ({
      name,
      start: item.offset,
      end: item.offset + item.nbytes,
    }))
    .sort((left, right) => left.start - right.start);
  for (const range of ranges) {
    if (
      range.start < payloadStart ||
      range.start % 4 !== 0 ||
      range.end > buffer.byteLength
    ) {
      throw new Error(`${range.name} offset exceeds the point-cloud payload`);
    }
  }
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) {
      throw new Error("point-cloud array offsets overlap");
    }
  }
  if (ranges.at(-1)?.end !== buffer.byteLength) {
    throw new Error("point-cloud payload length does not match the header");
  }
  return {
    manifest,
    positions: new Float32Array(
      buffer,
      manifest.arrays.positions.offset,
      manifest.point_count * 3,
    ),
    colors: new Uint8Array(
      buffer,
      manifest.arrays.colors.offset,
      manifest.point_count * 3,
    ),
    pixelIndex: new Uint32Array(
      buffer,
      manifest.arrays.pixel_index.offset,
      manifest.point_count,
    ),
  };
}

export function stableLod(pointCount: number, maxPoints: number): Uint32Array {
  if (
    !Number.isSafeInteger(pointCount) ||
    pointCount < 0 ||
    pointCount > 0xffff_ffff
  ) {
    throw new Error("pointCount is invalid");
  }
  if (!Number.isSafeInteger(maxPoints) || maxPoints <= 0)
    throw new Error("maxPoints is invalid");
  const count = Math.min(pointCount, maxPoints);
  const indices = new Uint32Array(count);
  if (count === 0) return indices;
  if (count === 1) return indices;
  if (pointCount <= maxPoints) {
    for (let index = 0; index < count; index += 1) indices[index] = index;
    return indices;
  }
  for (let index = 0; index < count; index += 1) {
    indices[index] = Math.floor((index * (pointCount - 1)) / (count - 1));
  }
  return indices;
}
