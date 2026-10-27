import canonicalize from "canonicalize";
import type { ProcessingSpec } from "./processing";
import type { Scene, SourceDescriptor } from "./scene";
import { blobBytes } from "@/shared/binary";

export function canonicalJson(value: unknown): string {
  const encoded = canonicalize(value);
  if (encoded === undefined) throw new TypeError("value is not JSON serializable");
  return encoded;
}
export function canonicalJsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalJson(value)).slice();
}
export async function sha256(data: BufferSource): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
export async function hashBlob(blob: Blob, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  if (blob.size > 512 * 1024 * 1024) throw new Error("source exceeds the browser hashing budget");
  return sha256(await blobBytes(blob));
}

/** Only immutable, geometry-relevant content participates in Scene identity. */
export function canonicalSceneContent(
  scene: Omit<Scene, "sceneHash"> | Scene,
): Omit<Scene, "sceneHash" | "sceneId" | "name"> {
  return {
    format: scene.format,
    schemaVersion: scene.schemaVersion,
    sources: scene.sources,
    geometry: scene.geometry,
    frameId: scene.frameId,
    coordinateConvention: scene.coordinateConvention,
    normalizerVersion: scene.normalizerVersion,
    decoderContractVersion: scene.decoderContractVersion,
  };
}
export async function sceneHash(scene: Omit<Scene, "sceneHash"> | Scene): Promise<string> {
  return sha256(canonicalJsonBytes(canonicalSceneContent(scene)));
}
export async function derivationKey(
  sceneHashValue: string,
  processing: ProcessingSpec,
  processorVersion: string,
): Promise<string> {
  return sha256(
    canonicalJsonBytes({
      format: "rgbd-workbench/derivation-key",
      schemaVersion: 2,
      sceneHash: sceneHashValue,
      processing,
      processorVersion,
    }),
  );
}
export async function withSceneHash(scene: Omit<Scene, "sceneHash">): Promise<Scene> {
  return { ...scene, sceneHash: await sceneHash(scene) };
}
export function sourceIdentity(source: SourceDescriptor): string {
  return source.sha256;
}
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}
