import type {
  Processor,
  SourceSelection,
  ScenePreparationResult,
  DerivationResult,
} from "@/application/contracts";
import { WorkbenchError, diagnostic } from "@/domain/diagnostics";
import type { ProcessingSpec } from "@/domain/processing";
import type { Scene } from "@/domain/scene";
import type { CameraPath, RenderSpec } from "@/domain/trajectory";
import type { PointCloudBuffer } from "@/domain/derivation";
import { encodePointCloud, parsePointCloud } from "@/domain/pointcloud-protocol";
import { prepareScene } from "../prepare";
import { decodeRgb } from "../codecs/image";
import { decodeDepth } from "../codecs";
import { sourceFile } from "../codecs/source-files";
import { derivePointCloud } from "../pointcloud";
import type { RenderSources } from "../render/cpu-renderer";
import type { WorkerRequest, WorkerResponse } from "./protocol";

interface Pending {
  resolve: (value: WorkerResponse) => void;
  reject: (cause: unknown) => void;
  signal?: AbortSignal;
  abort: () => void;
  onProgress?: (progress: number) => void;
}
export class WorkerProcessor implements Processor {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, Pending>();
  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./compute.worker.ts", import.meta.url), {
        type: "module",
        name: "rgbd-compute",
      });
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
      this.worker.onerror = (event) => {
        this.failAll(
          new WorkbenchError(diagnostic("WORKER_FAILED", "fatal", "runtime.failure"), {
            cause: new Error(event.message),
          }),
        );
      };
    }
    return this.worker;
  }
  private failAll(cause: unknown): void {
    for (const pending of this.pending.values()) {
      pending.signal?.removeEventListener("abort", pending.abort);
      pending.reject(cause);
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }
  private receive(response: WorkerResponse): void {
    const pending = this.pending.get(response.operationId);
    if (!pending) return;
    if (response.kind === "progress") {
      pending.onProgress?.(response.progress);
      return;
    }
    this.pending.delete(response.operationId);
    pending.signal?.removeEventListener("abort", pending.abort);
    if (response.kind === "failure") {
      if (response.aborted)
        pending.reject(new DOMException("The operation was aborted", "AbortError"));
      else
        pending.reject(
          new WorkbenchError(
            response.diagnostics[0] ?? diagnostic("WORKER_FAILED", "fatal", "runtime.failure"),
          ),
        );
    } else pending.resolve(response);
  }
  private async call(
    request: WorkerRequest,
    signal?: AbortSignal,
    transfers: Transferable[] = [],
    onProgress?: (progress: number) => void,
  ): Promise<WorkerResponse> {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        // A terminated Worker releases native encoding and large allocations. Lazy restart on next call.
        const worker = this.worker;
        this.worker = null;
        worker?.terminate();
        for (const [id, pending] of this.pending) {
          pending.signal?.removeEventListener("abort", pending.abort);
          if (id !== request.operationId)
            pending.reject(
              new WorkbenchError(diagnostic("WORKER_RESTARTED", "fatal", "runtime.failure")),
            );
        }
        this.pending.clear();
        reject(new DOMException("The operation was aborted", "AbortError"));
      };
      this.pending.set(request.operationId, {
        resolve,
        reject,
        ...(signal ? { signal } : {}),
        ...(onProgress ? { onProgress } : {}),
        abort,
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.getWorker().postMessage(request, { transfer: transfers });
    });
  }
  async prepare(input: SourceSelection, signal?: AbortSignal): Promise<ScenePreparationResult> {
    const response = await this.call(
      { kind: "prepare", operationId: crypto.randomUUID(), input },
      signal,
    );
    if (response.kind !== "prepared") throw new Error("unexpected worker response");
    return response.result as ScenePreparationResult;
  }
  async derive(
    scene: Scene,
    sources: { rgb: Blob; depth: Blob },
    processing: ProcessingSpec,
    signal?: AbortSignal,
  ): Promise<DerivationResult> {
    const response = await this.call(
      { kind: "derive", operationId: crypto.randomUUID(), scene, sources, processing },
      signal,
    );
    if (response.kind !== "derived") throw new Error("unexpected worker response");
    const cloud = parsePointCloud(response.payload);
    return {
      manifest: cloud.manifest,
      cloud,
      arrays: {
        positions: cloud.positions,
        colors: cloud.colors,
        pixels: cloud.sourcePixelIndex,
        count: cloud.manifest.pointCount,
      },
      cached: response.cached,
    };
  }
  async renderVideo(
    cloud: PointCloudBuffer,
    path: CameraPath,
    render: RenderSpec,
    signal?: AbortSignal,
    onProgress?: (progress: number) => void,
    sources?: RenderSources,
  ): Promise<Blob> {
    const payload = encodePointCloud(cloud.manifest, {
      positions: cloud.positions,
      colors: cloud.colors,
      pixels: cloud.sourcePixelIndex,
      count: cloud.manifest.pointCount,
    });
    const response = await this.call(
      {
        kind: "video",
        operationId: crypto.randomUUID(),
        payload,
        path,
        render,
        ...(sources ? { sources } : {}),
      },
      signal,
      [payload],
      onProgress,
    );
    if (response.kind !== "video") throw new Error("unexpected worker response");
    return new Blob([response.payload], { type: response.mediaType });
  }
  dispose(): void {
    this.failAll(new Error("processor disposed"));
  }
}

/** In-process adapter for deterministic tests, not a second production runtime. */
export class LocalProcessor implements Processor {
  async prepare(input: SourceSelection): Promise<ScenePreparationResult> {
    return prepareScene(input);
  }
  async derive(
    scene: Scene,
    sources: { rgb: Blob; depth: Blob },
    processing: ProcessingSpec,
    signal?: AbortSignal,
  ): Promise<DerivationResult> {
    const [rgb, depth] = await Promise.all([
      decodeRgb(sourceFile(scene, "rgb", sources.rgb)),
      decodeDepth(
        sourceFile(scene, "depth", sources.depth),
        scene.geometry.rawDescriptor ?? undefined,
      ),
    ]);
    const { manifest, cloud } = await derivePointCloud(scene, rgb, depth, processing, signal);
    const payload = encodePointCloud(manifest, cloud);
    const parsed = parsePointCloud(payload);
    return { manifest, cloud: parsed, arrays: cloud, cached: false };
  }
  renderVideo(): Promise<Blob> {
    return Promise.reject(
      new WorkbenchError(diagnostic("VIDEO_REQUIRES_WORKER", "fatal", "runtime.unsupported")),
    );
  }
  dispose(): void {}
}
