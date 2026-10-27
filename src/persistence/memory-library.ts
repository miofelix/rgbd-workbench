import type { Library, StoredDerivation } from "@/application/contracts";
import type { Scene } from "@/domain/scene";
import type { DerivationManifest } from "@/domain/derivation";
import { sourceArchiveSchema } from "@/domain/source-archive";
import { canonicalJsonBytes, sha256 } from "@/domain/identity";
import { blobBytes } from "@/shared/binary";
import { writeZip } from "@/shared/zip";

/** In-memory adapter with the same public archive contract as browser persistence. */
export class MemoryLibrary implements Library {
  scenes = new Map<string, Scene>();
  sources = new Map<
    string,
    { rgb: Blob; depth: Blob; previews: Awaited<ReturnType<Library["readSources"]>>["previews"] }
  >();
  derivations = new Map<string, StoredDerivation>();
  async listScenes(): Promise<Scene[]> {
    return [...this.scenes.values()];
  }
  async getScene(id: string): Promise<Scene | null> {
    return this.scenes.get(id) ?? null;
  }
  async commitScene(
    scene: Scene,
    sources: { rgb: Blob; depth: Blob },
    previews: Awaited<ReturnType<Library["readSources"]>>["previews"],
  ): Promise<void> {
    this.scenes.set(scene.sceneId, scene);
    this.sources.set(scene.sceneId, { rgb: sources.rgb, depth: sources.depth, previews });
  }
  async readSources(id: string): ReturnType<Library["readSources"]> {
    const value = this.sources.get(id);
    if (!value) throw new Error("scene not found");
    return value;
  }
  async getDerivation(sceneId: string, key: string): Promise<StoredDerivation | null> {
    return this.derivations.get(`${sceneId}:${key}`) ?? null;
  }
  async putDerivation(manifest: DerivationManifest, payload: Blob): Promise<void> {
    this.derivations.set(`${manifest.sceneId}:${manifest.derivationKey}`, { manifest, payload });
  }
  async clearDerivation(sceneId: string, key: string): Promise<void> {
    this.derivations.delete(`${sceneId}:${key}`);
  }
  async removeScene(id: string): Promise<void> {
    this.scenes.delete(id);
    this.sources.delete(id);
    for (const [key, derivation] of this.derivations)
      if (derivation.manifest.sceneId === id) this.derivations.delete(key);
  }
  async archive(id: string, includeDerivations = false): Promise<Blob> {
    const scene = await this.getScene(id);
    if (!scene) throw new Error("scene not found");
    const sources = await this.readSources(id);
    const entries: Record<string, Uint8Array> = {
      "sources/rgb": new Uint8Array(await blobBytes(sources.rgb)),
      "sources/depth": new Uint8Array(await blobBytes(sources.depth)),
    };
    if (includeDerivations)
      for (const derivation of this.derivations.values())
        if (derivation.manifest.sceneId === id)
          entries[`derivations/${derivation.manifest.derivationKey}.bin`] = new Uint8Array(
            await blobBytes(derivation.payload),
          );
    const manifest = sourceArchiveSchema.parse({
      format: "rgbd-workbench/source-archive",
      schemaVersion: 2,
      sceneId: scene.sceneId,
      sceneSha256: scene.sceneHash,
      entries: await Promise.all(
        Object.entries(entries).map(async ([path, data]) => ({
          path,
          byteLength: data.byteLength,
          sha256: await sha256(data.slice().buffer),
        })),
      ),
    });
    const payload = writeZip({
      "archive.json": canonicalJsonBytes(manifest),
      "scene.json": canonicalJsonBytes(scene),
      ...entries,
    });
    return new Blob([payload.buffer], { type: "application/zip" });
  }
  async clearCache(id?: string): Promise<void> {
    if (!id) this.derivations.clear();
    else
      for (const [key, derivation] of this.derivations)
        if (derivation.manifest.sceneId === id) this.derivations.delete(key);
  }
}
