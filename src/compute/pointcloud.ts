import { capabilityReport } from "@/domain/capabilities";
import { derivationKey } from "@/domain/identity";
import { WorkbenchError, diagnostic, throwIfAborted } from "@/domain/diagnostics";
import type { DerivationManifest } from "@/domain/derivation";
import type { ProcessingSpec } from "@/domain/processing";
import type { Scene } from "@/domain/scene";
import type { NumericArray } from "@/domain/codec-registry";
import type { RgbImage } from "./codecs/image";
import { KDTree } from "./kd-tree";

export const PROCESSOR_VERSION = "2.0.0";
export interface CloudArrays {
  positions: Float32Array;
  colors: Uint8Array;
  pixels: Uint32Array;
  count: number;
}
class CloudBuilder {
  positions: Float32Array;
  colors: Uint8Array;
  pixels: Uint32Array;
  count = 0;
  constructor(capacity: number) {
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Uint8Array(capacity * 3);
    this.pixels = new Uint32Array(capacity);
  }
  add(x: number, y: number, z: number, rgb: RgbImage, pixel: number): void {
    const i = this.count++;
    const p = i * 3;
    const c = pixel * 3;
    this.positions[p] = x;
    this.positions[p + 1] = y;
    this.positions[p + 2] = z;
    this.colors[p] = rgb.pixels[c]!;
    this.colors[p + 1] = rgb.pixels[c + 1]!;
    this.colors[p + 2] = rgb.pixels[c + 2]!;
    this.pixels[i] = pixel;
  }
  result(): CloudArrays {
    return {
      positions: this.positions.subarray(0, this.count * 3),
      colors: this.colors.subarray(0, this.count * 3),
      pixels: this.pixels.subarray(0, this.count),
      count: this.count,
    };
  }
}
function select(cloud: CloudArrays, indices: Uint32Array | number[]): CloudArrays {
  const positions = new Float32Array(indices.length * 3);
  const colors = new Uint8Array(indices.length * 3);
  const pixels = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i += 1) {
    const source = indices[i]!;
    pixels[i] = cloud.pixels[source]!;
    for (let c = 0; c < 3; c += 1) {
      positions[i * 3 + c] = cloud.positions[source * 3 + c]!;
      colors[i * 3 + c] = cloud.colors[source * 3 + c]!;
    }
  }
  return { positions, colors, pixels, count: indices.length };
}
function voxel(cloud: CloudArrays, size: number): CloudArrays {
  const groups = new Map<
    string,
    {
      x: number;
      y: number;
      z: number;
      r: number;
      g: number;
      b: number;
      count: number;
      pixel: number;
    }
  >();
  for (let i = 0; i < cloud.count; i += 1) {
    const p = i * 3;
    const pixel = cloud.pixels[i]!;
    const key = `${Math.floor(cloud.positions[p]! / size)},${Math.floor(cloud.positions[p + 1]! / size)},${Math.floor(cloud.positions[p + 2]! / size)}`;
    const group = groups.get(key);
    if (group) {
      group.x += cloud.positions[p]!;
      group.y += cloud.positions[p + 1]!;
      group.z += cloud.positions[p + 2]!;
      group.r += cloud.colors[p]!;
      group.g += cloud.colors[p + 1]!;
      group.b += cloud.colors[p + 2]!;
      group.count += 1;
      group.pixel = Math.min(group.pixel, pixel);
    } else
      groups.set(key, {
        x: cloud.positions[p]!,
        y: cloud.positions[p + 1]!,
        z: cloud.positions[p + 2]!,
        r: cloud.colors[p]!,
        g: cloud.colors[p + 1]!,
        b: cloud.colors[p + 2]!,
        count: 1,
        pixel,
      });
  }
  const sorted = [...groups.values()].sort((a, b) => a.pixel - b.pixel);
  const result = new CloudBuilder(sorted.length);
  // The synthetic pixel is a representative, not a fabricated source coordinate.
  sorted.forEach((g, i) => {
    result.positions[i * 3] = g.x / g.count;
    result.positions[i * 3 + 1] = g.y / g.count;
    result.positions[i * 3 + 2] = g.z / g.count;
    result.colors[i * 3] = Math.round(g.r / g.count);
    result.colors[i * 3 + 1] = Math.round(g.g / g.count);
    result.colors[i * 3 + 2] = Math.round(g.b / g.count);
    result.pixels[i] = g.pixel;
  });
  result.count = sorted.length;
  return result.result();
}
function budget(cloud: CloudArrays, maximum: number): CloudArrays {
  if (cloud.count <= maximum) return cloud;
  return select(
    cloud,
    Uint32Array.from({ length: maximum }, (_, i) =>
      Math.floor((i * (cloud.count - 1)) / (maximum - 1)),
    ),
  );
}
function knnFilter(cloud: CloudArrays, k: number, stdRatio: number): CloudArrays {
  if (cloud.count <= 2) return cloud;
  const tree = new KDTree(cloud.positions, cloud.count);
  const mean = new Float64Array(cloud.count);
  const spread = new Float64Array(cloud.count);
  let totalMean = 0;
  let totalSpread = 0;
  for (let i = 0; i < cloud.count; i += 1) {
    const neighbors = tree
      .nearest(i, k + 1)
      .filter((n) => n.index !== i)
      .slice(0, k);
    const distances = neighbors.map((n) => Math.sqrt(n.distanceSquared));
    const average = distances.reduce((a, b) => a + b, 0) / distances.length;
    const variance = distances.reduce((sum, d) => sum + (d - average) ** 2, 0) / distances.length;
    mean[i] = average;
    spread[i] = Math.sqrt(variance);
    totalMean += average;
    totalSpread += spread[i]!;
  }
  const threshold = totalMean / cloud.count + stdRatio * Math.max(totalSpread / cloud.count, 1e-12);
  const indices: number[] = [];
  for (let i = 0; i < cloud.count; i += 1) if (mean[i]! <= threshold) indices.push(i);
  return select(cloud, indices);
}
function knnSmooth(cloud: CloudArrays, k: number): CloudArrays {
  if (cloud.count <= 1) return cloud;
  const tree = new KDTree(cloud.positions, cloud.count);
  const positions = new Float32Array(cloud.positions.length);
  for (let i = 0; i < cloud.count; i += 1) {
    const neighbors = tree.nearest(i, k);
    for (let c = 0; c < 3; c += 1) {
      let sum = 0;
      for (const n of neighbors) sum += cloud.positions[n.index * 3 + c]!;
      positions[i * 3 + c] = sum / neighbors.length;
    }
  }
  return { ...cloud, positions };
}
export async function derivePointCloud(
  scene: Scene,
  rgb: RgbImage,
  depth: NumericArray,
  processing: ProcessingSpec,
  signal?: AbortSignal,
): Promise<{ manifest: DerivationManifest; cloud: CloudArrays }> {
  throwIfAborted(signal);
  const capabilities = capabilityReport(scene);
  if (!capabilities.relative_pointcloud && !capabilities.metric_pointcloud)
    throw new WorkbenchError(
      diagnostic("DERIVATION_CAPABILITY_BLOCKED", "fatal", "geometry.invalid", {
        capability: "metric_pointcloud",
      }),
    );
  if (
    depth.width !== rgb.width ||
    depth.height !== rgb.height ||
    depth.width * depth.height !== rgb.pixels.length / 3
  )
    throw new WorkbenchError(diagnostic("RGB_DEPTH_SIZE_MISMATCH", "fatal", "geometry.invalid"));
  const camera = scene.geometry.camera!;
  const semantics = scene.geometry.depth;
  const work =
    processing.maxPoints * ((processing.knnFilter?.k ?? 0) + (processing.knnSmooth?.k ?? 0));
  if (work > 16_000_000)
    throw new WorkbenchError(
      diagnostic("DERIVATION_RESOURCE_LIMIT", "fatal", "pointcloud.budget", {
        field: "processing.knn",
      }),
    );
  const [sourceHeight, sourceWidth] = [depth.height, depth.width];
  const roi = processing.roi ?? [0, 0, sourceWidth, sourceHeight];
  const [xMin, xMax, yMin, yMax] = [
    Math.max(0, roi[0]),
    Math.min(sourceWidth, roi[2]),
    Math.max(0, roi[1]),
    Math.min(sourceHeight, roi[3]),
  ];
  if (xMin >= xMax || yMin >= yMax)
    throw new WorkbenchError(
      diagnostic("ROI_EMPTY", "fatal", "pointcloud.empty", { field: "processing.roi" }),
    );
  const scale =
    semantics.representation === "relative_z"
      ? 1
      : (semantics.scaleToMeter ?? (semantics.unit === "mm" ? 0.001 : 1));
  const builder = new CloudBuilder(
    Math.ceil((xMax - xMin) / processing.pixelStride) *
      Math.ceil((yMax - yMin) / processing.pixelStride),
  );
  for (let y = yMin; y < yMax; y += processing.pixelStride) {
    for (let x = xMin; x < xMax; x += processing.pixelStride) {
      const pixel = y * sourceWidth + x;
      const raw = depth.data[pixel]!;
      const valid = Number.isFinite(raw) && raw > 0 && !semantics.invalidValues.includes(raw);
      if (!valid) continue;
      const z = Math.fround(raw * scale);
      if (
        !Number.isFinite(z) ||
        z <= 0 ||
        (semantics.validMin !== null && z < semantics.validMin) ||
        (semantics.validMax !== null && z > semantics.validMax)
      )
        continue;
      if (
        (processing.depthMin !== null && z < processing.depthMin) ||
        (processing.depthMax !== null && z > processing.depthMax)
      )
        continue;
      const px = Math.fround((Math.fround(x - camera.cx) * z) / camera.fx);
      const py = Math.fround((Math.fround(y - camera.cy) * z) / camera.fy);
      if (
        processing.xyzMin &&
        (px < processing.xyzMin[0] || py < processing.xyzMin[1] || z < processing.xyzMin[2])
      )
        continue;
      if (
        processing.xyzMax &&
        (px > processing.xyzMax[0] || py > processing.xyzMax[1] || z > processing.xyzMax[2])
      )
        continue;
      builder.add(px, py, z, rgb, pixel);
    }
    throwIfAborted(signal);
    if (y % (processing.pixelStride * 128) === 0) await Promise.resolve();
  }
  let cloud = builder.result();
  if (processing.voxelSize !== null) cloud = voxel(cloud, processing.voxelSize);
  cloud = budget(cloud, processing.maxPoints);
  if (processing.knnFilter)
    cloud = knnFilter(cloud, processing.knnFilter.k, processing.knnFilter.stdRatio);
  if (processing.knnSmooth) cloud = knnSmooth(cloud, processing.knnSmooth.k);
  if (cloud.count === 0 || ![...cloud.positions].every(Number.isFinite))
    throw new WorkbenchError(diagnostic("POINTCLOUD_EMPTY", "fatal", "pointcloud.empty"));
  const key = await derivationKey(scene.sceneHash, processing, PROCESSOR_VERSION);
  const manifest: DerivationManifest = {
    format: "rgbd-workbench/derivation",
    schemaVersion: 2,
    derivationKey: key,
    sceneId: scene.sceneId,
    sceneHash: scene.sceneHash,
    processorVersion: PROCESSOR_VERSION,
    processing,
    pointCount: cloud.count,
    sourceShape: [sourceHeight, sourceWidth],
    frameId: scene.frameId,
    unit: semantics.representation === "z_depth" ? "m" : "unitless",
    representation: semantics.representation,
    bounds: { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
    arrays: {
      positions: {
        dataType: "float32",
        shape: [cloud.count, 3],
        byteOffset: 0,
        byteLength: cloud.positions.byteLength,
      },
      colors: {
        dataType: "uint8",
        shape: [cloud.count, 3],
        byteOffset: 0,
        byteLength: cloud.colors.byteLength,
      },
      sourcePixelIndex: {
        dataType: "uint32",
        shape: [cloud.count],
        byteOffset: 0,
        byteLength: cloud.pixels.byteLength,
      },
    },
  };
  for (let i = 0; i < cloud.count; i += 1)
    for (let c = 0; c < 3; c += 1) {
      manifest.bounds.min[c] = Math.min(manifest.bounds.min[c]!, cloud.positions[i * 3 + c]!);
      manifest.bounds.max[c] = Math.max(manifest.bounds.max[c]!, cloud.positions[i * 3 + c]!);
    }
  return { manifest, cloud };
}
