import { decode, encode } from "fast-png";
import { assertRasterSize, type NumericArray } from "@/domain/codec-registry";
import type { RgbImage } from "./image";
import { asArrayBuffer } from "@/shared/binary";

function decodeRaster(input: ArrayBuffer): ReturnType<typeof decode> {
  const decoded = decode(input, { checkCrc: true });
  assertRasterSize(decoded.width, decoded.height);
  return decoded;
}
export function decodePngRgb(input: ArrayBuffer): RgbImage {
  const { data, width, height, channels, depth } = decodeRaster(input);
  if (depth !== 8 && depth !== 16) throw new Error("RGB PNG must use 8-bit or 16-bit channels");
  if (![1, 2, 3, 4].includes(channels) || data.length !== width * height * channels)
    throw new Error("RGB PNG raster is invalid");
  const pixels = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const sourceChannel = channels >= 3 ? channel : 0;
      const value = data[pixel * channels + sourceChannel]!;
      pixels[pixel * 3 + channel] = depth === 16 ? Math.round(value / 257) : value;
    }
  }
  return { pixels, width, height };
}

/** Depth PNG preserves 16-bit grayscale samples; browser Canvas RGB is never used. */
export function decodePngDepth(input: ArrayBuffer): NumericArray {
  const { data, width, height, channels, depth } = decodeRaster(input);
  if (channels !== 1 || (depth !== 8 && depth !== 16) || data.length !== width * height)
    throw new Error("depth PNG must be 8-bit or 16-bit single-channel grayscale");
  return depth === 16
    ? { data: data as Uint16Array, dataType: "uint16", width, height }
    : { data: data as Uint8Array, dataType: "uint8", width, height };
}

export function encodePng(rgb: Uint8Array, width: number, height: number): ArrayBuffer {
  if (rgb.length !== width * height * 3) throw new Error("PNG RGB buffer length mismatch");
  return asArrayBuffer(encode({ width, height, data: rgb, channels: 3, depth: 8 }));
}
export function encodePng16(values: Uint16Array, width: number, height: number): ArrayBuffer {
  if (values.length !== width * height) throw new Error("PNG depth buffer length mismatch");
  return asArrayBuffer(encode({ width, height, data: values, channels: 1, depth: 16 }));
}
