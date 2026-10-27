import type { PointCloudBuffer } from "@/domain/derivation";
import type { CameraPath, RenderSpec } from "@/domain/trajectory";
import { sampleCameraPath } from "../trajectory/path";
import { projectPoint, viewProjection } from "./projection";
import { sampleColorMap } from "./color-map";
import { stableLod } from "@/domain/pointcloud-protocol";

export interface RenderSources {
  rgb: Uint8Array;
  depthPreview: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
  roi: [number, number, number, number] | null;
}
export interface RasterViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}
function renderPointcloud(
  cloud: PointCloudBuffer,
  path: CameraPath,
  render: RenderSpec,
  frame: number,
  viewport: RasterViewport,
  canvasWidth: number,
  pixels: Uint8Array,
): void {
  const { x: offsetX, y: offsetY, width, height } = viewport;
  const pose = sampleCameraPath(path, frame, render.fps);
  const vp = viewProjection(pose, width, height);
  const depth = new Float32Array(width * height);
  depth.fill(Infinity);
  const radius = Math.max(0.5, (render.pointSize * render.antiAlias) / 2);
  const zMin = render.colorRange.min;
  const zSpan = Math.max(1e-12, render.colorRange.max - zMin);
  const indices = stableLod(cloud.manifest.pointCount, render.maxPoints);
  for (const i of indices) {
    const position: [number, number, number] = [
      cloud.positions[i * 3]!,
      cloud.positions[i * 3 + 1]!,
      cloud.positions[i * 3 + 2]!,
    ];
    const point = projectPoint(position, pose, vp, width, height);
    if (!point) continue;
    let color: [number, number, number] = [
      cloud.colors[i * 3]!,
      cloud.colors[i * 3 + 1]!,
      cloud.colors[i * 3 + 2]!,
    ];
    if (render.colorMode === "depth")
      color = sampleColorMap(render.colorMap, (position[2] - zMin) / zSpan);
    else if (render.colorMode === "mono") color = [125, 207, 192];
    else if (render.colorMode === "validity") color = [112, 196, 151];
    const cx = Math.round(point.x) + offsetX;
    const cy = Math.round(point.y) + offsetY;
    const r = Math.ceil(radius);
    for (let dy = -r; dy <= r; dy += 1)
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < offsetX || y < offsetY || x >= offsetX + width || y >= offsetY + height) continue;
        const local = (y - offsetY) * width + x - offsetX;
        if (point.depth >= depth[local]!) continue;
        depth[local] = point.depth;
        const index = (y * canvasWidth + x) * 3;
        pixels[index] = color[0];
        pixels[index + 1] = color[1];
        pixels[index + 2] = color[2];
      }
  }
}

function drawSource(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  roi: [number, number, number, number] | null,
  viewport: RasterViewport,
  canvasWidth: number,
  pixels: Uint8Array,
): void {
  const [x0, y0, x1, y1] = roi ?? [0, 0, sourceWidth, sourceHeight];
  const cropWidth = Math.max(1, Math.min(sourceWidth, x1) - Math.max(0, x0));
  const cropHeight = Math.max(1, Math.min(sourceHeight, y1) - Math.max(0, y0));
  const factor = Math.min(viewport.width / cropWidth, viewport.height / cropHeight);
  const width = Math.max(1, Math.round(cropWidth * factor));
  const height = Math.max(1, Math.round(cropHeight * factor));
  const left = viewport.x + Math.floor((viewport.width - width) / 2);
  const top = viewport.y + Math.floor((viewport.height - height) / 2);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(sourceWidth - 1, Math.max(0, x0) + Math.floor((x * cropWidth) / width));
      const sy = Math.min(
        sourceHeight - 1,
        Math.max(0, y0) + Math.floor((y * cropHeight) / height),
      );
      const color = (sy * sourceWidth + sx) * 3;
      const index = ((top + y) * canvasWidth + left + x) * 3;
      pixels[index] = source[color]!;
      pixels[index + 1] = source[color + 1]!;
      pixels[index + 2] = source[color + 2]!;
    }
}

/** Deterministic CPU frame rendering. Interactive Three.js state is never read. */
export function renderCpuFrame(
  cloud: PointCloudBuffer,
  path: CameraPath,
  render: RenderSpec,
  frame: number,
  sources?: RenderSources,
): Uint8Array {
  const scale = render.antiAlias;
  const width = render.width * scale;
  const height = render.height * scale;
  const pixels = new Uint8Array(width * height * 3);
  const background: [number, number, number] =
    render.background === "light" ? [242, 245, 244] : [15, 28, 39];
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = background[0];
    pixels[i + 1] = background[1];
    pixels[i + 2] = background[2];
  }
  const cloudViewport =
    render.layout === "rgb_depth_pointcloud"
      ? { x: 0, y: Math.floor(height / 2), width, height: height - Math.floor(height / 2) }
      : { x: 0, y: 0, width, height };
  if (render.layout === "rgb_depth_pointcloud") {
    if (!sources) throw new Error("RGB/depth split rendering requires source rasters");
    const half = Math.floor(width / 2);
    const topHeight = Math.floor(height / 2);
    drawSource(
      sources.rgb,
      sources.sourceWidth,
      sources.sourceHeight,
      sources.roi,
      { x: 0, y: 0, width: half, height: topHeight },
      width,
      pixels,
    );
    drawSource(
      sources.depthPreview,
      sources.sourceWidth,
      sources.sourceHeight,
      sources.roi,
      { x: half, y: 0, width: width - half, height: topHeight },
      width,
      pixels,
    );
  }
  renderPointcloud(cloud, path, render, frame, cloudViewport, width, pixels);
  return scale === 1 ? pixels : downsample(pixels, width, height, scale);
}
function downsample(source: Uint8Array, width: number, height: number, scale: number): Uint8Array {
  const targetWidth = width / scale;
  const targetHeight = height / scale;
  const result = new Uint8Array(targetWidth * targetHeight * 3);
  if (scale === 1) return source;
  // Lanczos-2 evaluated at fractional offsets -1.5, -0.5, 0.5, 1.5.
  const weights = [1 / (3 * Math.PI ** 2), 1, 1, 1 / (3 * Math.PI ** 2)];
  const normalization = weights.reduce((sum, value) => sum + value, 0) ** 2;
  const sample = (x: number, y: number, channel: number): number =>
    source[
      (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 3 +
        channel
    ]!;
  for (let y = 0; y < targetHeight; y += 1)
    for (let x = 0; x < targetWidth; x += 1)
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let dy = -1; dy <= 2; dy += 1)
          for (let dx = -1; dx <= 2; dx += 1) {
            const weight = weights[dx + 1]! * weights[dy + 1]!;
            sum += sample(x * scale + dx, y * scale + dy, channel) * weight;
          }
        result[(y * targetWidth + x) * 3 + channel] = Math.max(
          0,
          Math.min(255, Math.round(sum / normalization)),
        );
      }
  return result;
}
export function frameToRgba(rgb: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const result = new Uint8ClampedArray((rgb.length / 3) * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    result[j] = rgb[i]!;
    result[j + 1] = rgb[i + 1]!;
    result[j + 2] = rgb[i + 2]!;
    result[j + 3] = 255;
  }
  return result;
}
