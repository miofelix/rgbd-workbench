export const FORMAT_LIMITS = {
  maxFileBytes: 512 * 1024 * 1024,
  maxPixels: 16 * 1024 * 1024,
  maxArrayBytes: 256 * 1024 * 1024,
  maxDepthElements: 16 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024,
} as const;

export type NumericDataType =
  "uint8" | "uint16" | "uint32" | "int8" | "int16" | "int32" | "float16" | "float32" | "float64";
export interface NumericArray {
  data:
    | Uint8Array
    | Uint16Array
    | Uint32Array
    | Int8Array
    | Int16Array
    | Int32Array
    | Float32Array
    | Float64Array;
  dataType: NumericDataType;
  height: number;
  width: number;
}
export function assertRasterSize(
  width: number,
  height: number,
  maxPixels = FORMAT_LIMITS.maxPixels,
): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 32768 ||
    height > 32768 ||
    width * height > maxPixels
  ) {
    throw new RangeError("raster dimensions exceed configured limits");
  }
}
export function dtypeInfo(dataType: NumericDataType): {
  bytes: number;
  kind: "float" | "signed" | "unsigned";
} {
  if (dataType.startsWith("float")) return { bytes: Number(dataType.slice(5)) / 8, kind: "float" };
  if (dataType.startsWith("uint"))
    return { bytes: Number(dataType.slice(4)) / 8, kind: "unsigned" };
  return { bytes: Number(dataType.slice(3)) / 8, kind: "signed" };
}
export const DTYPE_INFO: Record<NumericDataType, ReturnType<typeof dtypeInfo>> = {
  uint8: { bytes: 1, kind: "unsigned" },
  uint16: { bytes: 2, kind: "unsigned" },
  uint32: { bytes: 4, kind: "unsigned" },
  int8: { bytes: 1, kind: "signed" },
  int16: { bytes: 2, kind: "signed" },
  int32: { bytes: 4, kind: "signed" },
  float16: { bytes: 2, kind: "float" },
  float32: { bytes: 4, kind: "float" },
  float64: { bytes: 8, kind: "float" },
};
export const SUPPORTED_RGB_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "tif", "tiff"]);
export const SUPPORTED_DEPTH_EXTENSIONS = new Set([
  "png",
  "tif",
  "tiff",
  "npy",
  "npz",
  "pfm",
  "raw",
  "bin",
]);
