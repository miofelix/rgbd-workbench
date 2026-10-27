import type { Scene } from "@/domain/scene";
import type { Library } from "@/application/contracts";
import type { RenderSources } from "./cpu-renderer";
import type { ProcessingSpec } from "@/domain/processing";
import { WorkbenchError, diagnostic } from "@/domain/diagnostics";
export async function loadRenderSources(
  library: Library,
  scene: Scene,
  processing: ProcessingSpec,
): Promise<RenderSources | undefined> {
  if (!processing) return undefined;
  const { previews } = await library.readSources(scene.sceneId);
  if (!previews.depthPreview || !previews.depth)
    throw new WorkbenchError(
      diagnostic("RENDER_SOURCES_MISSING", "fatal", "source.missing", {
        capability: "video_export",
      }),
    );
  return {
    rgb: previews.rgb.pixels,
    depthPreview: previews.depthPreview,
    sourceWidth: previews.depth.width,
    sourceHeight: previews.depth.height,
    roi: processing.roi,
  };
}
