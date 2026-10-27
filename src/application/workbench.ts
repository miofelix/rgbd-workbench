import type {
  DerivationResult,
  Library,
  Processor,
  ScenePreparationResult,
  SourceSelection,
} from "./contracts";
import { sceneSchema, type GeometryContract, type Scene } from "@/domain/scene";
import { processingSpecSchema, type ProcessingSpec } from "@/domain/processing";
import { withSceneHash } from "@/domain/identity";
import { encodePointCloud, parsePointCloud } from "@/domain/pointcloud-protocol";
import { derivationKey } from "@/domain/identity";
import { PROCESSOR_VERSION } from "@/compute/pointcloud";
import { WorkbenchError, diagnostic, throwIfAborted } from "@/domain/diagnostics";
import type { CameraPath, ExportJob, RenderSpec } from "@/domain/trajectory";
import { ExportJobState, freezeRenderInput } from "@/compute/export-job";
import { createExportManifest } from "@/compute/export-manifest";
import { frameCount } from "@/compute/trajectory/path";
import { blobBytes } from "@/shared/binary";
import { loadRenderSources } from "@/compute/render/render-sources";

export class Workbench {
  constructor(
    private readonly library: Library,
    private readonly processor: Processor,
  ) {}
  get libraryAccess(): Library {
    return this.library;
  }
  listScenes(): Promise<Scene[]> {
    return this.library.listScenes();
  }
  prepare(input: SourceSelection, signal?: AbortSignal): Promise<ScenePreparationResult> {
    return this.processor.prepare(input, signal);
  }
  async commitScene(
    preparation: ScenePreparationResult,
    name: string,
    geometry: GeometryContract,
    selection: SourceSelection,
    signal?: AbortSignal,
  ): Promise<Scene> {
    throwIfAborted(signal);
    if (!preparation.depth || !preparation.rgb)
      throw new WorkbenchError(diagnostic("DEPTH_NOT_DECODED", "fatal", "source.decodeFailed"));
    const scene = sceneSchema.parse(
      await withSceneHash({
        format: "rgbd-workbench/scene",
        schemaVersion: 2,
        sceneId: crypto.randomUUID(),
        name,
        sources: preparation.sources,
        geometry,
        frameId: "camera",
        coordinateConvention: "x_right_y_down_z_forward",
        normalizerVersion: "2.0.0",
        decoderContractVersion: "2.0.0",
      }),
    );
    await this.library.commitScene(scene, selection, preparation);
    return scene;
  }
  async derive(
    scene: Scene,
    processing: ProcessingSpec,
    signal?: AbortSignal,
  ): Promise<DerivationResult> {
    const validated = processingSpecSchema.parse(processing);
    const key = await derivationKey(scene.sceneHash, validated, PROCESSOR_VERSION);
    let cached: DerivationResult | null = null;
    try {
      cached = await this.readPointCloud(scene.sceneId, key);
    } catch {
      await this.library.clearDerivation(scene.sceneId, key);
    }
    if (cached) return cached;
    const sources = await this.library.readSources(scene.sceneId);
    const result = await this.processor.derive(scene, sources, validated, signal);
    const payload = encodePointCloud(result.manifest, result.arrays);
    await this.library.putDerivation(
      result.manifest,
      new Blob([payload], { type: "application/vnd.rgbd-workbench.pointcloud-v2" }),
    );
    return result;
  }
  async readCachedDerivation(
    sceneId: string,
    sceneHash: string,
    processing: ProcessingSpec,
  ): Promise<DerivationResult | null> {
    const key = await derivationKey(
      sceneHash,
      processingSpecSchema.parse(processing),
      PROCESSOR_VERSION,
    );
    return this.readPointCloud(sceneId, key);
  }
  async readPointCloud(sceneId: string, key: string): Promise<DerivationResult | null> {
    const stored = await this.library.getDerivation(sceneId, key);
    if (!stored) return null;
    const cloud = parsePointCloud(await blobBytes(stored.payload));
    return {
      manifest: cloud.manifest,
      cloud,
      arrays: {
        positions: cloud.positions,
        colors: cloud.colors,
        pixels: cloud.sourcePixelIndex,
        count: cloud.manifest.pointCount,
      },
      cached: true,
    };
  }
  async renderVideo(
    cloud: DerivationResult["cloud"],
    path: CameraPath,
    render: RenderSpec,
    signal?: AbortSignal,
    onProgress?: (progress: number) => void,
    onJob?: (job: ExportJob) => void,
  ): Promise<Blob> {
    const frozen = freezeRenderInput({ derivation: cloud.manifest, cameraPath: path, render });
    const job = new ExportJobState(frozen);
    onJob?.(job.snapshot());
    onJob?.(job.start());
    if (frozen.derivation.derivationKey !== cloud.manifest.derivationKey) {
      onJob?.(job.fail());
      throw new Error("render snapshot changed");
    }
    let sources;
    try {
      sources =
        frozen.render.layout === "rgb_depth_pointcloud"
          ? await loadRenderSources(
              this.library,
              await this.requireScene(cloud.manifest.sceneId),
              frozen.derivation.processing,
            )
          : undefined;
    } catch (cause) {
      if (signal?.aborted) {
        job.cancel();
        onJob?.(job.cancelled());
      } else onJob?.(job.fail());
      throw cause;
    }
    try {
      const result = await this.processor.renderVideo(
        cloud,
        frozen.cameraPath,
        frozen.render,
        signal,
        (progress) => {
          onProgress?.(progress);
          onJob?.(job.progress(progress));
        },
        sources,
      );
      onJob?.(job.succeed());
      return result;
    } catch (cause) {
      if (signal?.aborted) {
        job.cancel();
        onJob?.(job.cancelled());
      } else onJob?.(job.fail());
      throw cause;
    }
  }
  sources(sceneId: string): ReturnType<Library["readSources"]> {
    return this.library.readSources(sceneId);
  }
  private async requireScene(sceneId: string): Promise<Scene> {
    const scene = await this.library.getScene(sceneId);
    if (!scene) throw new WorkbenchError(diagnostic("SCENE_NOT_FOUND", "fatal", "source.missing"));
    return scene;
  }
  async videoSidecar(
    cloud: DerivationResult["cloud"],
    path: CameraPath,
    render: RenderSpec,
    video: Blob,
  ): Promise<Blob> {
    const manifest = await createExportManifest({
      sceneId: cloud.manifest.sceneId,
      derivation: cloud.manifest,
      cameraPath: path,
      render,
      frameCount: frameCount(path, render.fps),
      duration: frameCount(path, render.fps) / render.fps,
      blob: video,
      kind: "video",
      encoder:
        render.codec === "avc" ? "WebCodecs/H.264 + Mediabunny" : "WebCodecs/VP9 + Mediabunny",
    });
    return new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  }
  removeScene(sceneId: string): Promise<void> {
    return this.library.removeScene(sceneId);
  }
  archive(sceneId: string, includeDerivations = false): Promise<Blob> {
    return this.library.archive(sceneId, includeDerivations);
  }
  clearCache(sceneId?: string): Promise<void> {
    return this.library.clearCache(sceneId);
  }
  dispose(): void {
    this.processor.dispose();
    this.library.close?.();
  }
}
