import { getFirstEncodableVideoCodec, Mp4OutputFormat, WebMOutputFormat } from "mediabunny";
import type { RenderSpec } from "@/domain/trajectory";
export interface VideoCapability {
  container: "mp4" | "webm";
  codec: "avc" | "vp9";
  available: boolean;
}
export async function probeVideoCodecs(render: RenderSpec): Promise<VideoCapability[]> {
  if (typeof VideoEncoder === "undefined" || typeof OffscreenCanvas === "undefined")
    return [
      { container: "mp4", codec: "avc", available: false },
      { container: "webm", codec: "vp9", available: false },
    ];
  const formats = [
    { container: "mp4", codec: "avc", format: new Mp4OutputFormat() },
    { container: "webm", codec: "vp9", format: new WebMOutputFormat() },
  ] as const;
  return Promise.all(
    formats.map(async ({ container, codec, format }) => ({
      container,
      codec,
      available:
        (await getFirstEncodableVideoCodec([codec], {
          width: render.width,
          height: render.height,
          frameRate: render.fps,
        })) !== null && format.getSupportedVideoCodecs().includes(codec),
    })),
  );
}
