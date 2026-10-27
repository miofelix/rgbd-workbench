import type { PointCloudBuffer, DerivationManifest } from "@/domain/derivation";
import type { ProcessingSpec } from "@/domain/processing";
import type { Scene, ScenePreparation } from "@/domain/scene";
import type { CameraPath, RenderSpec, ExportJob } from "@/domain/trajectory";
import type { RgbImage } from "@/compute/codecs/image";
import type { NumericArray } from "@/domain/codec-registry";
import type { CloudArrays } from "@/compute/pointcloud";
import type { RenderSources } from "@/compute/render/cpu-renderer";
import type { RawDescriptor } from "@/compute/codecs/types";

export interface SourceSelection {
  rgb: File;
  depth: File;
  manifest?: File;
  name?: string;
}
export interface ScenePreparationResult extends ScenePreparation {
  suggestedName?: string;
  rgb: RgbImage;
  depth: NumericArray | null;
  depthPreview: Uint8Array | null;
  rawDescriptor?: RawDescriptor;
}
export interface StoredDerivation {
  manifest: DerivationManifest;
  payload: Blob;
}
export interface DerivationResult {
  manifest: DerivationManifest;
  cloud: PointCloudBuffer;
  arrays: CloudArrays;
  cached: boolean;
}
export interface Library {
  close?(): void;
  listScenes(): Promise<Scene[]>;
  getScene(sceneId: string): Promise<Scene | null>;
  commitScene(
    scene: Scene,
    sources: { rgb: Blob; depth: Blob; manifest?: Blob },
    previews: { rgb: RgbImage; depth: NumericArray | null; depthPreview: Uint8Array | null },
  ): Promise<void>;
  readSources(sceneId: string): Promise<{
    rgb: Blob;
    depth: Blob;
    previews: { rgb: RgbImage; depth: NumericArray | null; depthPreview: Uint8Array | null };
  }>;
  getDerivation(sceneId: string, key: string): Promise<StoredDerivation | null>;
  putDerivation(manifest: DerivationManifest, payload: Blob): Promise<void>;
  clearDerivation(sceneId: string, key: string): Promise<void>;
  removeScene(sceneId: string): Promise<void>;
  archive(sceneId: string, includeDerivations?: boolean): Promise<Blob>;
  clearCache(sceneId?: string): Promise<void>;
}
export interface Processor {
  prepare(input: SourceSelection, signal?: AbortSignal): Promise<ScenePreparationResult>;
  derive(
    scene: Scene,
    sources: { rgb: Blob; depth: Blob },
    processing: ProcessingSpec,
    signal?: AbortSignal,
  ): Promise<DerivationResult>;
  renderVideo(
    cloud: PointCloudBuffer,
    path: CameraPath,
    render: RenderSpec,
    signal?: AbortSignal,
    onProgress?: (progress: number) => void,
    sources?: RenderSources,
  ): Promise<Blob>;
  dispose(): void;
}
export type { ExportJob };
