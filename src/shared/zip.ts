import { unzipSync, zipSync, type Zippable } from "fflate";

export interface ZipBudget {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}
export const SOURCE_ARCHIVE_BUDGET: ZipBudget = {
  maxArchiveBytes: 1024 * 1024 * 1024,
  maxEntries: 32,
  maxEntryBytes: 512 * 1024 * 1024,
  maxTotalBytes: 768 * 1024 * 1024,
};
export const NPZ_BUDGET: ZipBudget = {
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntries: 128,
  maxEntryBytes: 256 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

/** fflate's synchronous inflater allocates all output; enforce member and total bounds first. */
export function readBoundedZip(
  input: ArrayBuffer | Uint8Array,
  budget: ZipBudget,
  accept: (name: string) => boolean = () => true,
): Record<string, Uint8Array> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > budget.maxArchiveBytes) throw new RangeError("ZIP exceeds archive budget");
  const names: string[] = [];
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (entry) => {
      if (
        entry.name.startsWith("/") ||
        entry.name.includes("\\") ||
        entry.name.split("/").includes("..")
      )
        throw new Error("unsafe ZIP entry path");
      if (entry.originalSize === undefined) throw new Error("ZIP entry has no declared size");
      if (entry.originalSize > budget.maxEntryBytes)
        throw new RangeError("ZIP entry exceeds resource budget");
      if (!accept(entry.name)) return false;
      names.push(entry.name);
      if (names.length > budget.maxEntries) throw new RangeError("ZIP has too many entries");
      total += entry.originalSize;
      if (total > budget.maxTotalBytes)
        throw new RangeError("ZIP uncompressed content exceeds budget");
      return true;
    },
  });
  let actualTotal = 0;
  for (const data of Object.values(files)) {
    actualTotal += data.byteLength;
    if (data.byteLength > budget.maxEntryBytes || actualTotal > budget.maxTotalBytes)
      throw new RangeError("ZIP inflated content exceeds budget");
  }
  return files;
}
export function writeZip(
  files: Zippable,
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 0,
): Uint8Array<ArrayBuffer> {
  return zipSync(files, { level }).slice();
}
