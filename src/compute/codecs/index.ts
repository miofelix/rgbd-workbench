import { FORMAT_LIMITS, type NumericArray } from "@/domain/codec-registry";
import { parseNpy, parseNpz } from "./npy";
import { parsePfm, parseRaw } from "./raw-depth";
import { decodeTiffDepth } from "./image";
import { decodePngDepth } from "./png";
import { blobBytes } from "@/shared/binary";
import type { RawDescriptor } from "./types";

export function fileExtension(name: string): string {
  return name.split(".").at(-1)?.toLowerCase() ?? "";
}
export async function decodeDepth(
  file: Blob & { name?: string },
  rawDescriptor?: RawDescriptor,
): Promise<NumericArray> {
  if (file.size > FORMAT_LIMITS.maxFileBytes) throw new RangeError("depth source exceeds budget");
  const extension = fileExtension(file.name ?? "");
  if (extension === "png") return decodePngDepth(await blobBytes(file));
  if (extension === "npy") return parseNpy(await blobBytes(file));
  if (extension === "npz") return parseNpz(await blobBytes(file));
  if (extension === "pfm") return parsePfm(await blobBytes(file));
  if (extension === "raw" || extension === "bin") {
    if (!rawDescriptor) throw new Error("RAW requires explicit shape, dtype and endianness");
    return parseRaw(await blobBytes(file), rawDescriptor);
  }
  if (extension === "tif" || extension === "tiff") return decodeTiffDepth(await blobBytes(file));
  throw new Error("unsupported depth format; use NPY, NPZ, PFM, TIFF or described RAW");
}
