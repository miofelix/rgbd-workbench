import {
  DTYPE_INFO,
  FORMAT_LIMITS,
  assertRasterSize,
  type NumericArray,
  type NumericDataType,
} from "@/domain/codec-registry";
import { readBoundedZip, NPZ_BUDGET } from "@/shared/zip";

const NPY_TYPES: Record<string, NumericDataType> = {
  u1: "uint8",
  u2: "uint16",
  u4: "uint32",
  i1: "int8",
  i2: "int16",
  i4: "int32",
  f2: "float16",
  f4: "float32",
  f8: "float64",
};
function bytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}
function parseHeader(text: string): {
  dataType: NumericDataType;
  littleEndian: boolean;
  fortranOrder: boolean;
  shape: [number, number];
} {
  const match = text.match(
    /^\s*\{\s*'descr'\s*:\s*'([<>=|]?[uif][1248])'\s*,\s*'fortran_order'\s*:\s*(False|True)\s*,\s*'shape'\s*:\s*\(\s*(\d+)\s*,\s*(\d+)\s*,?\s*\)\s*,?\s*\}\s*$/,
  );
  if (!match)
    throw new Error("NPY header is invalid; only numeric two-dimensional arrays are supported");
  const descr = match[1];
  const order = match[2];
  const height = match[3];
  const width = match[4];
  if (!descr || !order || !height || !width) throw new Error("NPY header is incomplete");
  const code = descr.at(-2)! + descr.at(-1)!;
  const dataType = NPY_TYPES[code];
  if (!dataType) throw new Error("NPY dtype is unsupported");
  if (descr[0] === ">") {
    if (dataType && descr[0] === ">" && DTYPE_INFO[dataType].bytes > 1)
      return {
        dataType,
        littleEndian: false,
        fortranOrder: order === "True",
        shape: [Number(height), Number(width)],
      };
    throw new Error("NPY dtype is unsupported");
  }
  return {
    dataType,
    littleEndian: true,
    fortranOrder: order === "True",
    shape: [Number(height), Number(width)],
  };
}
export function parseNpy(input: ArrayBuffer | Uint8Array): NumericArray {
  const source = bytes(input);
  if (
    source.length < 12 ||
    source[0] !== 0x93 ||
    new TextDecoder().decode(source.subarray(1, 6)) !== "NUMPY"
  )
    throw new Error("NPY magic is invalid");
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const major = source[6];
  const headerLength =
    major === 1
      ? view.getUint16(8, true)
      : major === 2 || major === 3
        ? view.getUint32(8, true)
        : 0;
  const offset = major === 1 ? 10 : 12;
  if (!headerLength || offset + headerLength > source.length)
    throw new Error("NPY header exceeds file");
  const header = parseHeader(
    new TextDecoder("utf-8", { fatal: true }).decode(
      source.subarray(offset, offset + headerLength),
    ),
  );
  const [height, width] = header.shape;
  assertRasterSize(width, height);
  const { bytes: itemSize } = DTYPE_INFO[header.dataType];
  const length = height * width;
  if (
    length * itemSize > FORMAT_LIMITS.maxArrayBytes ||
    offset + headerLength + length * itemSize !== source.length
  )
    throw new Error("NPY payload length does not match header");
  if (header.fortranOrder)
    throw new Error("Fortran-order NPY is not supported; save C-order arrays");
  const payload = source.subarray(offset + headerLength);
  const aligned = payload.byteOffset % itemSize === 0;
  const copy = aligned ? payload : payload.slice();
  const buffer = copy.buffer;
  const byteOffset = copy.byteOffset;
  if (!header.littleEndian && itemSize > 1) {
    const swapped = payload.slice();
    for (let i = 0; i < swapped.length; i += itemSize) swapped.subarray(i, i + itemSize).reverse();
    return {
      data: typedArray(header.dataType, swapped.buffer, 0, length),
      dataType: header.dataType,
      height,
      width,
    };
  }
  return {
    data: typedArray(header.dataType, buffer, byteOffset, length),
    dataType: header.dataType,
    height,
    width,
  };
}
function typedArray(
  type: NumericDataType,
  buffer: ArrayBufferLike,
  offset: number,
  length: number,
  littleEndian = true,
): NumericArray["data"] {
  switch (type) {
    case "uint8":
      return new Uint8Array(buffer, offset, length);
    case "uint16":
      return new Uint16Array(buffer, offset, length);
    case "uint32":
      return new Uint32Array(buffer, offset, length);
    case "int8":
      return new Int8Array(buffer, offset, length);
    case "int16":
      return new Int16Array(buffer, offset, length);
    case "int32":
      return new Int32Array(buffer, offset, length);
    case "float32":
      return new Float32Array(buffer, offset, length);
    case "float64":
      return new Float64Array(buffer, offset, length);
    case "float16": {
      const result = new Float32Array(length);
      const view = new DataView(buffer, offset, length * 2);
      for (let i = 0; i < length; i += 1)
        result[i] = decodeFloat16(view.getUint16(i * 2, littleEndian));
      return result;
    }
  }
}
function decodeFloat16(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? Number.NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}
export function parseNpz(input: ArrayBuffer | Uint8Array, memberName?: string): NumericArray {
  const members = readBoundedZip(input, NPZ_BUDGET, (name) => name.endsWith(".npy"));
  const names = Object.keys(members);
  if (names.length === 0 || (memberName === undefined && names.length !== 1))
    throw new Error("NPZ must contain one explicitly selected NPY array");
  const name = memberName ?? names[0];
  if (!name) throw new Error("NPZ member is missing");
  if (name.includes("..") || name.startsWith("/") || !members[name])
    throw new Error("NPZ member is invalid");
  return parseNpy(members[name]);
}
