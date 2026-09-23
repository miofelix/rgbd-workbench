import type {
  DerivationManifest,
  DerivationResponse,
  ProcessingSpec,
} from "../../web/src/api/types";

export const defaultProcessing: ProcessingSpec = {
  schema_version: 1,
  roi: null,
  depth_min: null,
  depth_max: null,
  xyz_min: null,
  xyz_max: null,
  pixel_stride: 1,
  max_points: 2_000_000,
  voxel_size: null,
  knn_filter: null,
  knn_smooth: null,
};

const align4 = (value: number): number => (value + 3) & ~3;

export function pointcloudPayload(): ArrayBuffer {
  const encoder = new TextEncoder();
  let payloadStart = 0;
  let manifest!: DerivationManifest;
  let header!: Uint8Array;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const positionsOffset = align4(payloadStart);
    const colorsOffset = align4(positionsOffset + 24);
    const pixelOffset = align4(colorsOffset + 6);
    manifest = derivationManifest("scene-1", {
      positions: {
        dtype: "float32",
        shape: [2, 3],
        offset: positionsOffset,
        nbytes: 24,
      },
      colors: {
        dtype: "uint8",
        shape: [2, 3],
        offset: colorsOffset,
        nbytes: 6,
      },
      pixel_index: {
        dtype: "uint32",
        shape: [2],
        offset: pixelOffset,
        nbytes: 8,
      },
    });
    header = encoder.encode(JSON.stringify(manifest));
    const nextStart = align4(12 + header.byteLength);
    if (nextStart === payloadStart) break;
    payloadStart = nextStart;
  }

  const end =
    manifest.arrays.pixel_index.offset + manifest.arrays.pixel_index.nbytes;
  const buffer = new ArrayBuffer(end);
  const bytes = new Uint8Array(buffer);
  bytes.set(encoder.encode("RGBDPC1\0"), 0);
  new DataView(buffer).setUint32(8, header.byteLength, true);
  bytes.set(header, 12);
  new Float32Array(buffer, manifest.arrays.positions.offset, 6).set([
    -0.1, -0.1, 1, 0, -0.2, 2,
  ]);
  bytes.set([10, 20, 30, 40, 50, 60], manifest.arrays.colors.offset);
  new Uint32Array(buffer, manifest.arrays.pixel_index.offset, 2).set([0, 1]);
  return buffer;
}

export function corruptOffsetPayload(): ArrayBuffer {
  const source = pointcloudPayload();
  const bytes = new Uint8Array(source);
  const view = new DataView(source);
  const headerLength = view.getUint32(8, true);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const header = decoder.decode(bytes.slice(12, 12 + headerLength));
  const match = header.match(/"positions":\{[^}]*"offset":(\d+)/);
  if (!match)
    throw new Error("fixture header does not contain positions offset");
  const replacement = "9".repeat(match[1].length);
  const corruptHeader = header.replace(
    `"offset":${match[1]}`,
    `"offset":${replacement}`,
  );
  const output = source.slice(0);
  new Uint8Array(output).set(encoder.encode(corruptHeader), 12);
  return output;
}

export function derivationManifest(
  sceneId = "scene-1",
  arrays: DerivationManifest["arrays"] = {
    positions: { dtype: "float32", shape: [2, 3], offset: 0, nbytes: 24 },
    colors: { dtype: "uint8", shape: [2, 3], offset: 24, nbytes: 6 },
    pixel_index: { dtype: "uint32", shape: [2], offset: 32, nbytes: 8 },
  },
): DerivationManifest {
  return {
    schema_version: 1,
    derivation_id: `derivation-${"a".repeat(64)}`,
    scene_id: sceneId,
    scene_hash: "b".repeat(64),
    derivation_key: "a".repeat(64),
    processor_version: "1",
    processing: defaultProcessing,
    point_count: 2,
    source_shape: [2, 2],
    frame: "camera",
    unit: "m",
    representation: "z_depth",
    bounds: { min: [-0.1, -0.2, 1], max: [0, -0.1, 2] },
    arrays,
    diagnostics: [],
    created_at: null,
  };
}

export function derivationResponse(sceneId = "scene-1"): DerivationResponse {
  const derivation = derivationManifest(sceneId);
  return {
    schema_version: 1,
    cached: false,
    derivation,
    urls: {
      pointcloud: `/api/v1/derivations/${derivation.derivation_id}/pointcloud`,
      ply: `/api/v1/derivations/${derivation.derivation_id}/export/ply`,
      json: `/api/v1/derivations/${derivation.derivation_id}/export/json`,
    },
    diagnostics: [],
    capabilities: { metric_pointcloud: true },
  };
}
