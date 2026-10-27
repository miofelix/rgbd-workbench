import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
} from "mediabunny";
import type { CameraPath, RenderSpec } from "@/domain/trajectory";
import { WorkbenchError, diagnostic, throwIfAborted } from "@/domain/diagnostics";
import type { PointCloudBuffer } from "@/domain/derivation";
import { frameCount } from "../trajectory/path";
import { frameToRgba, renderCpuFrame, type RenderSources } from "./cpu-renderer";

import { probeVideoCodecs } from "./video-capabilities";

export interface EncodeOptions {
  cloud: PointCloudBuffer;
  path: CameraPath;
  render: RenderSpec;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  sources?: RenderSources;
}
export async function encodeVideo({
  cloud,
  path,
  render,
  signal,
  onProgress,
  sources,
}: EncodeOptions): Promise<Blob> {
  if (render.codec === "png") throw new Error("PNG sequence uses the archive exporter");
  const container = render.codec === "avc" ? "mp4" : "webm";
  const capability = (await probeVideoCodecs(render)).find(
    (item) => item.codec === (render.codec as "avc" | "vp9"),
  );
  if (!capability?.available)
    throw new WorkbenchError(
      diagnostic("EXPORT_CODEC_UNSUPPORTED", "fatal", "export.unsupported", {
        capability: "video_export",
        params: { container },
      }),
    );
  const canvas = new OffscreenCanvas(render.width, render.height);
  const context = canvas.getContext("2d");
  if (!context)
    throw new WorkbenchError(diagnostic("CANVAS_UNAVAILABLE", "fatal", "runtime.unsupported"));
  const target = new BufferTarget();
  const format = render.codec === "avc" ? new Mp4OutputFormat() : new WebMOutputFormat();
  const output = new Output({ format, target });
  const source = new CanvasSource(canvas, {
    codec: render.codec,
    quality: new Quality(render.quality),
  });
  output.addVideoTrack(source);
  await output.start();
  const count = frameCount(path, render.fps);
  try {
    for (let frame = 0; frame < count; frame += 1) {
      throwIfAborted(signal);
      const pixels = renderCpuFrame(cloud, path, render, frame, sources);
      context.putImageData(new ImageData(frameToRgba(pixels), render.width, render.height), 0, 0);
      await source.add(frame / render.fps, 1 / render.fps);
      onProgress?.((frame + 1) / count);
    }
    await output.finalize();
    if (!target.buffer) throw new Error("video output is empty");
    return new Blob([target.buffer], { type: render.codec === "avc" ? "video/mp4" : "video/webm" });
  } catch (cause) {
    await output.cancel().catch(() => undefined);
    throw cause;
  }
}
