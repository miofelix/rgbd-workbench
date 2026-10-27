import {
  assertRasterSize,
  FORMAT_LIMITS,
  type NumericArray,
  type NumericDataType,
} from "@/domain/codec-registry";
import { fromArrayBuffer } from "geotiff";
import { blobBytes } from "@/shared/binary";
import { decodePngRgb } from "./png";

export interface RgbImage {
  pixels: Uint8Array;
  width: number;
  height: number;
}
function extension(file: Blob & { name?: string }): string {
  return file.name?.split(".").at(-1)?.toLowerCase() ?? "";
}
export async function decodeRgb(file: Blob & { name?: string }): Promise<RgbImage> {
  const type = extension(file);
  if (["tif", "tiff"].includes(type)) return decodeTiffRgb(await blobBytes(file));
  if (type === "png") return decodePngRgb(await blobBytes(file));
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "none",
    premultiplyAlpha: "none",
    colorSpaceConversion: "default",
  });
  try {
    assertRasterSize(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("2D canvas is unavailable");
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const pixels = new Uint8Array(bitmap.width * bitmap.height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      pixels[j] = data[i]!;
      pixels[j + 1] = data[i + 1]!;
      pixels[j + 2] = data[i + 2]!;
    }
    return { pixels, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}
async function decodeTiffRgb(buffer: ArrayBuffer): Promise<RgbImage> {
  const tiff = await fromArrayBuffer(buffer);
  if ((await tiff.getImageCount()) !== 1)
    throw new Error("multi-page TIFF requires explicit page selection");
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  assertRasterSize(width, height);
  const samples = image.getSamplesPerPixel();
  const raster = await image.readRasters({
    interleave: true,
    samples: samples >= 4 ? [0, 1, 2] : samples === 2 ? [0, 1] : [0],
  });
  const values = raster as unknown as ArrayLike<number>;
  const pixels = new Uint8Array(width * height * 3);
  const channels = samples >= 4 ? 3 : samples;
  for (let i = 0; i < width * height; i += 1) {
    for (let c = 0; c < 3; c += 1)
      pixels[i * 3 + c] = Math.max(
        0,
        Math.min(255, Math.round(values[i * channels + Math.min(c, channels - 1)]!)),
      );
  }
  return { pixels, width, height };
}
export async function decodeTiffDepth(buffer: ArrayBuffer): Promise<NumericArray> {
  if (buffer.byteLength > FORMAT_LIMITS.maxFileBytes)
    throw new RangeError("TIFF exceeds source budget");
  const tiff = await fromArrayBuffer(buffer);
  if ((await tiff.getImageCount()) !== 1)
    throw new Error("multi-page TIFF requires explicit page selection");
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  assertRasterSize(width, height);
  if (image.getSamplesPerPixel() !== 1) throw new Error("depth TIFF must be single-channel");
  const directory = image.getFileDirectory();
  const bits = image.getBitsPerSample();
  const sampleFormat = (directory as unknown as { SampleFormat?: number[] }).SampleFormat?.[0] ?? 1;
  const dataType = tiffDataType(bits, sampleFormat);
  const raster = await image.readRasters({ interleave: true, samples: [0] });
  const values = raster as unknown as NumericArray["data"];
  if (values.length !== width * height) throw new Error("TIFF raster length mismatch");
  return { data: values, dataType, height, width };
}
function tiffDataType(bits: number, format: number): NumericDataType {
  if (format === 3 && bits === 32) return "float32";
  if (format === 3 && bits === 64) return "float64";
  if (format === 2 && bits === 16) return "int16";
  if (format === 2 && bits === 32) return "int32";
  if (format === 1 && bits === 8) return "uint8";
  if (format === 1 && bits === 16) return "uint16";
  if (format === 1 && bits === 32) return "uint32";
  throw new Error(`TIFF sample layout ${bits}/${format} is unsupported`);
}
export function rgbToCanvas(image: RgbImage): OffscreenCanvas {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d")!;
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0, j = 0; i < image.pixels.length; i += 3, j += 4) {
    rgba[j] = image.pixels[i]!;
    rgba[j + 1] = image.pixels[i + 1]!;
    rgba[j + 2] = image.pixels[i + 2]!;
    rgba[j + 3] = 255;
  }
  context.putImageData(new ImageData(rgba, image.width, image.height), 0, 0);
  return canvas;
}
