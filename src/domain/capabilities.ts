import type { Diagnostic, Capability } from "./diagnostics";
import type { Scene } from "./scene";
export type CapabilityReport = Record<Capability, boolean>;
export function capabilityReport(scene: Scene, diagnostics: Diagnostic[] = []): CapabilityReport {
  const { depth, camera, alignment } = scene.geometry;
  const rgb = scene.sources.rgb;
  const depthSource = scene.sources.depth;
  const blocked = (capability: Capability) =>
    diagnostics.some(
      (d) => d.severity === "fatal" && (d.capability === null || d.capability === capability),
    );
  const geometry =
    camera !== null &&
    alignment.state === "registered_to_rgb" &&
    camera.distortionModel === "none" &&
    rgb.width === camera.width &&
    rgb.height === camera.height &&
    depthSource.width === camera.width &&
    depthSource.height === camera.height;
  const relative = geometry && depth.representation === "relative_z" && depth.unit === "unitless";
  const metric =
    geometry &&
    depth.representation === "z_depth" &&
    (depth.unit === "m" || depth.unit === "mm" || depth.scaleToMeter !== null);
  const pointcloud =
    (relative || metric) && !blocked(metric ? "metric_pointcloud" : "relative_pointcloud");
  return {
    image_inspection:
      rgb.byteLength > 0 && depthSource.byteLength > 0 && !blocked("image_inspection"),
    relative_pointcloud: relative && !blocked("relative_pointcloud"),
    metric_pointcloud: metric && !blocked("metric_pointcloud"),
    trajectory: pointcloud && !blocked("trajectory"),
    video_export: pointcloud && !blocked("video_export"),
  };
}
