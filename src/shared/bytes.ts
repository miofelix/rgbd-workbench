import { asArrayBuffer, blobBytes } from "./binary";
export async function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") return blob.text();
  return new TextDecoder("utf-8", { fatal: true }).decode(await blobBytes(blob));
}
export function textBytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value).slice();
}
export { asArrayBuffer, blobBytes };
