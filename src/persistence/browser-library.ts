import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { zipSync, strToU8 } from "fflate";
import type { Library, StoredDerivation } from "@/application/contracts";
import { sceneSchema, type Scene } from "@/domain/scene";
import { sourceArchiveSchema } from "@/domain/source-archive";
import { derivationManifestSchema, type DerivationManifest } from "@/domain/derivation";
import { parsePointCloud } from "@/domain/pointcloud-protocol";
import { WorkbenchError, diagnostic } from "@/domain/diagnostics";
import type { NumericArray, NumericDataType } from "@/domain/codec-registry";
import type { RgbImage } from "@/compute/codecs/image";
import { canonicalJsonBytes, sha256 } from "@/domain/identity";
import { asArrayBuffer, blobBytes } from "@/shared/binary";

const DATABASE_VERSION = 2;
interface PreviewRecord {
  rgbPixels: ArrayBuffer;
  depthData: ArrayBuffer | null;
  depthDataType: NumericDataType | null;
  depthWidth: number | null;
  depthHeight: number | null;
  depthPreview: ArrayBuffer | null;
}
interface SceneRecord {
  scene: Scene;
  previews: PreviewRecord;
  createdAt: string;
}
interface DerivationRecord {
  id: string;
  key: string;
  sceneId: string;
  sceneHash: string;
  payload: ArrayBuffer;
  createdAt: string;
}
interface SourceRecord {
  sceneId: string;
  role: "rgb" | "depth" | "manifest";
  bytes: ArrayBuffer;
  mediaType: string;
  hash: string;
}
interface WorkbenchDb extends DBSchema {
  scenes: { key: string; value: SceneRecord };
  sources: { key: string; value: SourceRecord };
  derivations: { key: string; value: DerivationRecord; indexes: { byScene: string } };
}
type PreviewInput = { rgb: RgbImage; depth: NumericArray | null; depthPreview: Uint8Array | null };
function previews(input: PreviewInput): PreviewRecord {
  return {
    rgbPixels: asArrayBuffer(input.rgb.pixels),
    depthData: input.depth ? asArrayBuffer(input.depth.data) : null,
    depthDataType: input.depth?.dataType ?? null,
    depthWidth: input.depth?.width ?? null,
    depthHeight: input.depth?.height ?? null,
    depthPreview: input.depthPreview ? asArrayBuffer(input.depthPreview) : null,
  };
}
function numeric(record: PreviewRecord): NumericArray | null {
  if (!record.depthData || !record.depthDataType || !record.depthWidth || !record.depthHeight)
    return null;
  const factories = {
    uint8: Uint8Array,
    uint16: Uint16Array,
    uint32: Uint32Array,
    int8: Int8Array,
    int16: Int16Array,
    int32: Int32Array,
    float32: Float32Array,
    float64: Float64Array,
    float16: Float32Array,
  };
  return {
    data: new factories[record.depthDataType](record.depthData),
    dataType: record.depthDataType,
    width: record.depthWidth,
    height: record.depthHeight,
  };
}
function rgb(record: PreviewRecord, scene: Scene): RgbImage {
  if (!scene.sources.rgb.width || !scene.sources.rgb.height)
    throw new WorkbenchError(diagnostic("SOURCE_MISSING", "fatal", "source.missing"));
  return {
    pixels: new Uint8Array(record.rgbPixels),
    width: scene.sources.rgb.width,
    height: scene.sources.rgb.height,
  };
}
function storageError(cause: unknown): WorkbenchError {
  const quota =
    cause instanceof DOMException &&
    (cause.name === "QuotaExceededError" || cause.name === "NS_ERROR_DOM_QUOTA_REACHED");
  return new WorkbenchError(
    diagnostic(
      quota ? "STORAGE_QUOTA_EXCEEDED" : "STORAGE_COMMIT_FAILED",
      "fatal",
      quota ? "storage.quota" : "storage.failure",
    ),
    { cause },
  );
}

/** Versioned transactional browser persistence. Raw blobs never enter application JSON. */
export class BrowserLibrary implements Library {
  private readonly db: Promise<IDBPDatabase<WorkbenchDb>>;
  private connection: IDBPDatabase<WorkbenchDb> | null = null;
  constructor() {
    this.db = openDB<WorkbenchDb>("rgbd-workbench", DATABASE_VERSION, {
      upgrade(db) {
        db.createObjectStore("scenes", { keyPath: "scene.sceneId" });
        db.createObjectStore("sources");
        db.createObjectStore("derivations", { keyPath: "id" }).createIndex("byScene", "sceneId");
      },
    }).then((connection) => {
      this.connection = connection;
      return connection;
    });
  }
  close(): void {
    this.connection?.close();
    this.connection = null;
  }
  private async lock<T>(task: () => Promise<T>): Promise<T> {
    if (!navigator.locks) return task();
    return navigator.locks.request("rgbd-workbench-write", { mode: "exclusive" }, task);
  }
  async listScenes(): Promise<Scene[]> {
    const records = await (await this.db).getAll("scenes");
    return records
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((record) => sceneSchema.parse(record.scene));
  }
  async getScene(sceneId: string): Promise<Scene | null> {
    const record = await (await this.db).get("scenes", sceneId);
    return record ? sceneSchema.parse(record.scene) : null;
  }
  async commitScene(
    scene: Scene,
    sources: { rgb: Blob; depth: Blob; manifest?: Blob },
    previewsInput: PreviewInput,
  ): Promise<void> {
    const persisted = {
      rgb: {
        bytes: await blobBytes(sources.rgb),
        mediaType: sources.rgb.type || "application/octet-stream",
      },
      depth: {
        bytes: await blobBytes(sources.depth),
        mediaType: sources.depth.type || "application/octet-stream",
      },
      manifest: sources.manifest
        ? {
            bytes: await blobBytes(sources.manifest),
            mediaType: sources.manifest.type || "application/octet-stream",
          }
        : undefined,
    };
    const manifestHash = persisted.manifest ? await sha256(persisted.manifest.bytes) : null;
    await this.lock(async () => {
      try {
        const db = await this.db;
        const tx = db.transaction(["scenes", "sources"], "readwrite");
        await tx.objectStore("scenes").put({
          scene: sceneSchema.parse(scene),
          previews: previews(previewsInput),
          createdAt: new Date().toISOString(),
        });
        await Promise.all([
          tx.objectStore("sources").put(
            {
              sceneId: scene.sceneId,
              role: "rgb",
              ...persisted.rgb,
              hash: scene.sources.rgb.sha256,
            },
            `${scene.sceneId}:rgb`,
          ),
          tx.objectStore("sources").put(
            {
              sceneId: scene.sceneId,
              role: "depth",
              ...persisted.depth,
              hash: scene.sources.depth.sha256,
            },
            `${scene.sceneId}:depth`,
          ),
          ...(sources.manifest
            ? [
                tx.objectStore("sources").put(
                  {
                    sceneId: scene.sceneId,
                    role: "manifest",
                    ...persisted.manifest!,
                    hash: manifestHash!,
                  },
                  `${scene.sceneId}:manifest`,
                ),
              ]
            : []),
        ]);
        await tx.done;
      } catch (cause) {
        throw storageError(cause);
      }
    });
  }
  async readSources(sceneId: string): ReturnType<Library["readSources"]> {
    const db = await this.db;
    const scene = await this.getScene(sceneId);
    if (!scene) throw new WorkbenchError(diagnostic("SCENE_NOT_FOUND", "fatal", "source.missing"));
    const [record, rgbSource, depthSource] = await Promise.all([
      db.get("scenes", sceneId),
      db.get("sources", `${sceneId}:rgb`),
      db.get("sources", `${sceneId}:depth`),
    ]);
    if (!record || !rgbSource || !depthSource)
      throw new WorkbenchError(diagnostic("SOURCE_MISSING", "fatal", "source.missing"));
    const entries = [
      { source: rgbSource, descriptor: scene.sources.rgb },
      { source: depthSource, descriptor: scene.sources.depth },
    ];
    for (const { source, descriptor } of entries) {
      if (
        source.hash !== descriptor.sha256 ||
        source.bytes.byteLength !== descriptor.byteLength ||
        (await sha256(source.bytes)) !== descriptor.sha256
      ) {
        throw new WorkbenchError(
          diagnostic("SOURCE_INTEGRITY_FAILED", "fatal", "source.integrity"),
        );
      }
    }
    return {
      rgb: new Blob([rgbSource.bytes], { type: rgbSource.mediaType }),
      depth: new Blob([depthSource.bytes], { type: depthSource.mediaType }),
      previews: {
        rgb: rgb(record.previews, scene),
        depth: numeric(record.previews),
        depthPreview: record.previews.depthPreview
          ? new Uint8Array(record.previews.depthPreview)
          : null,
      },
    };
  }
  async getDerivation(sceneId: string, key: string): Promise<StoredDerivation | null> {
    const record = await (await this.db).get("derivations", `${sceneId}:${key}`);
    if (!record) return null;
    const cloud = parsePointCloud(record.payload);
    if (cloud.manifest.derivationKey !== key || cloud.manifest.sceneHash !== record.sceneHash)
      throw new WorkbenchError(
        diagnostic("DERIVATION_INTEGRITY_FAILED", "fatal", "source.integrity"),
      );
    return {
      manifest: derivationManifestSchema.parse(cloud.manifest),
      payload: new Blob([record.payload], { type: "application/vnd.rgbd-workbench.pointcloud-v2" }),
    };
  }
  async putDerivation(manifest: DerivationManifest, payload: Blob): Promise<void> {
    await this.lock(async () => {
      const cloud = parsePointCloud(await blobBytes(payload));
      if (
        cloud.manifest.derivationKey !== manifest.derivationKey ||
        cloud.manifest.sceneHash !== manifest.sceneHash ||
        !(await this.getScene(manifest.sceneId))
      )
        throw new WorkbenchError(
          diagnostic("DERIVATION_INTEGRITY_FAILED", "fatal", "source.integrity"),
        );
      const db = await this.db;
      await db.put("derivations", {
        id: `${manifest.sceneId}:${manifest.derivationKey}`,
        key: manifest.derivationKey,
        sceneId: manifest.sceneId,
        sceneHash: manifest.sceneHash,
        payload: await blobBytes(payload),
        createdAt: new Date().toISOString(),
      });
    });
  }
  async removeScene(sceneId: string): Promise<void> {
    await this.lock(async () => {
      const db = await this.db;
      const tx = db.transaction(["scenes", "sources", "derivations"], "readwrite");
      const derived = await tx.objectStore("derivations").index("byScene").getAllKeys(sceneId);
      await Promise.all([
        tx.objectStore("scenes").delete(sceneId),
        tx.objectStore("sources").delete(`${sceneId}:rgb`),
        tx.objectStore("sources").delete(`${sceneId}:depth`),
        tx.objectStore("sources").delete(`${sceneId}:manifest`),
        ...derived.map((key) => tx.objectStore("derivations").delete(key)),
      ]);
      await tx.done;
    });
  }
  async clearDerivation(sceneId: string, key: string): Promise<void> {
    await (await this.db).delete("derivations", `${sceneId}:${key}`);
  }
  async clearCache(sceneId?: string): Promise<void> {
    await this.lock(async () => {
      const db = await this.db;
      if (sceneId) {
        const keys = await db.getAllKeysFromIndex("derivations", "byScene", sceneId);
        await Promise.all(keys.map((key) => db.delete("derivations", key)));
      } else await db.clear("derivations");
    });
  }
  async archive(sceneId: string, includeDerivations = false): Promise<Blob> {
    const scene = await this.getScene(sceneId);
    if (!scene) throw new WorkbenchError(diagnostic("SCENE_NOT_FOUND", "fatal", "source.missing"));
    const { rgb: rgbBlob, depth } = await this.readSources(sceneId);
    const manifestSource = await (await this.db).get("sources", `${sceneId}:manifest`);
    const sourceBytes: Record<string, Uint8Array> = {
      "sources/rgb": new Uint8Array(await blobBytes(rgbBlob)),
      "sources/depth": new Uint8Array(await blobBytes(depth)),
    };
    if (manifestSource) sourceBytes["manifests/source"] = new Uint8Array(manifestSource.bytes);
    if (includeDerivations) {
      const derivations = await (await this.db).getAllFromIndex("derivations", "byScene", sceneId);
      for (const derivation of derivations)
        sourceBytes[`derivations/${derivation.key}.bin`] = new Uint8Array(derivation.payload);
    }
    const entries = await Promise.all(
      Object.entries(sourceBytes).map(async ([path, data]) => ({
        path: path as
          "sources/rgb" | "sources/depth" | "manifests/source" | `derivations/${string}.bin`,
        byteLength: data.byteLength,
        sha256: await sha256(data.slice().buffer),
      })),
    );
    const manifest = sourceArchiveSchema.parse({
      format: "rgbd-workbench/source-archive",
      schemaVersion: 2,
      sceneId,
      sceneSha256: scene.sceneHash,
      entries,
    });
    const data = zipSync(
      {
        "archive.json": strToU8(JSON.stringify(manifest, null, 2)),
        "scene.json": canonicalJsonBytes(scene),
        ...sourceBytes,
      },
      { level: 0 },
    );
    return new Blob([data.slice().buffer], { type: "application/zip" });
  }
}
