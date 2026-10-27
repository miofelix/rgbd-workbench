/// <reference lib="webworker" />
import { prepareScene } from "../prepare";
import { decodeRgb } from "../codecs/image";
import { decodeDepth } from "../codecs";
import { sourceFile } from "../codecs/source-files";
import { derivePointCloud } from "../pointcloud";
import { encodePointCloud, parsePointCloud } from "@/domain/pointcloud-protocol";
import { asWorkbenchError, diagnostic } from "@/domain/diagnostics";

import { blobBytes } from "@/shared/binary";
import type { WorkerRequest } from "./protocol";

const cancelled = new Set<string>();
const scope = self as unknown as DedicatedWorkerGlobalScope;
function transfer(value: unknown): Transferable[] {
  const buffers: Transferable[] = [];
  const seen = new Set<object>();
  const visit = (item: unknown): void => {
    if (item instanceof ArrayBuffer && item.byteLength > 0 && !buffers.includes(item))
      buffers.push(item);
    else if (
      ArrayBuffer.isView(item) &&
      item.buffer instanceof ArrayBuffer &&
      !buffers.includes(item.buffer)
    )
      buffers.push(item.buffer);
    else if (item && typeof item === "object" && !(item instanceof Blob) && !seen.has(item)) {
      seen.add(item);
      Object.values(item).forEach(visit);
    }
  };
  visit(value);
  return buffers;
}
scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.kind === "cancel") {
    cancelled.add(request.operationId);
    return;
  }
  const { operationId } = request;
  const controller = new AbortController();
  const timer = setInterval(() => {
    if (cancelled.has(operationId)) controller.abort();
  }, 20);
  try {
    if (request.kind === "prepare") {
      const result = await prepareScene(request.input);
      scope.postMessage({ kind: "prepared", operationId, result }, { transfer: transfer(result) });
    } else if (request.kind === "derive") {
      const [rgb, depth] = await Promise.all([
        decodeRgb(sourceFile(request.scene, "rgb", request.sources.rgb)),
        decodeDepth(
          sourceFile(request.scene, "depth", request.sources.depth),
          request.scene.geometry.rawDescriptor ?? undefined,
        ),
      ]);
      const { manifest, cloud } = await derivePointCloud(
        request.scene,
        rgb,
        depth,
        request.processing,
        controller.signal,
      );
      const payload = encodePointCloud(manifest, cloud);
      scope.postMessage(
        { kind: "derived", operationId, payload, cached: false },
        { transfer: [payload] },
      );
    } else {
      const cloud = parsePointCloud(request.payload);
      const blob =
        request.render.codec === "png"
          ? await (
              await import("../render/frame-sequence")
            ).encodeFrameSequence(
              cloud,
              request.path,
              request.render,
              controller.signal,
              (progress) => scope.postMessage({ kind: "progress", operationId, progress }),
              request.sources,
            )
          : await (
              await import("../render/video-encoder")
            ).encodeVideo({
              cloud,
              path: request.path,
              render: request.render,
              ...(request.sources ? { sources: request.sources } : {}),
              signal: controller.signal,
              onProgress: (progress) =>
                scope.postMessage({ kind: "progress", operationId, progress }),
            });
      const payload = await blobBytes(blob);
      scope.postMessage(
        { kind: "video", operationId, payload, mediaType: blob.type },
        { transfer: [payload] },
      );
    }
  } catch (cause) {
    const aborted = controller.signal.aborted;
    const error = aborted
      ? asWorkbenchError(
          new Error("cancelled"),
          diagnostic("OPERATION_CANCELLED", "info", "runtime.failure"),
        )
      : asWorkbenchError(cause);
    scope.postMessage({ kind: "failure", operationId, diagnostics: error.diagnostics, aborted });
  } finally {
    clearInterval(timer);
    cancelled.delete(operationId);
  }
};
export {};
