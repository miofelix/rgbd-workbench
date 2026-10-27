import { DTYPE_INFO, assertRasterSize, type NumericArray } from "@/domain/codec-registry";
import type { RawDescriptor } from "./types";
import { parseNpy } from "./npy";

export function parsePfm(input: ArrayBuffer | Uint8Array): NumericArray {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const first = data.indexOf(10);
  const second = data.indexOf(10, first + 1);
  const third = data.indexOf(10, second + 1);
  if (first < 0 || second < 0 || third < 0) throw new Error("PFM header is incomplete");
  const ascii = (start: number, end: number) =>
    new TextDecoder("ascii").decode(data.subarray(start, end)).trim();
  if (ascii(0, first) !== "Pf") throw new Error("only single-channel PFM depth is supported");
  const dimensions = ascii(first + 1, second).match(/^(\d+)\s+(\d+)$/);
  if (!dimensions) throw new Error("PFM dimensions are invalid");
  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  assertRasterSize(width, height);
  const scale = Number(ascii(second + 1, third));
  if (!Number.isFinite(scale) || scale === 0) throw new Error("PFM scale is invalid");
  const expected = width * height * 4;
  if (data.length !== third + 1 + expected)
    throw new Error("PFM payload length does not match dimensions");
  const result = new Float32Array(width * height);
  const view = new DataView(data.buffer, data.byteOffset + third + 1, expected);
  const littleEndian = scale < 0;
  for (let sourceRow = 0; sourceRow < height; sourceRow += 1) {
    for (let x = 0; x < width; x += 1) {
      result[(height - sourceRow - 1) * width + x] = Math.fround(
        view.getFloat32((sourceRow * width + x) * 4, littleEndian) * Math.abs(scale),
      );
    }
  }
  return { data: result, dataType: "float32", height, width };
}
export function parseRaw(input: ArrayBuffer | Uint8Array, descriptor: RawDescriptor): NumericArray {
  const [height, width] = descriptor.shape;
  assertRasterSize(width, height);
  const info = DTYPE_INFO[descriptor.dataType];
  if (!info) throw new Error("RAW dtype is unsupported");
  const source = input instanceof Uint8Array ? input : new Uint8Array(input);
  const length = width * height;
  if (source.byteLength !== length * info.bytes)
    throw new Error("RAW byte length does not match descriptor");
  const header = `{'descr': '${descriptor.endianness === "little" ? "<" : ">"}${descriptor.dataType[0] === "f" ? "f" : descriptor.dataType[0] === "u" ? "u" : "i"}${info.bytes}', 'fortran_order': False, 'shape': (${height}, ${width}), }`;
  const pad = (16 - ((10 + header.length + 1) % 16)) % 16;
  const text = new TextEncoder().encode(`${header}${" ".repeat(pad)}\n`);
  const npy = new Uint8Array(10 + text.length + source.length);
  npy.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, text.length & 255, text.length >> 8]);
  npy.set(text, 10);
  npy.set(source, 10 + text.length);
  return parseNpy(npy);
}
