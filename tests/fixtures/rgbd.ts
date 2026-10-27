import { deflateSync } from "fflate";
import type { Scene } from "@/domain/scene";
import type { RgbImage } from "@/compute/codecs/image";
import type { NumericArray } from "@/domain/codec-registry";
export function npyFloat32(values: readonly number[], shape: [number, number]): Uint8Array {
  const text = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape[0]}, ${shape[1]}), }`;
  const header = new TextEncoder().encode(
    `${text}${" ".repeat((16 - ((10 + text.length + 1) % 16)) % 16)}\n`,
  );
  const result = new Uint8Array(10 + header.length + values.length * 4);
  result.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, header.length & 255, header.length >> 8]);
  result.set(header, 10);
  const view = new DataView(result.buffer);
  values.forEach((value, i) => view.setFloat32(10 + header.length + i * 4, value, true));
  return result;
}
export function metricScene(width = 2, height = 2): Scene {
  const source = (role: "rgb" | "depth") => ({
    format: "rgbd-workbench/source" as const,
    schemaVersion: 2 as const,
    role,
    name: `${role}.bin`,
    mediaType: null,
    byteLength: 1,
    sha256: "a".repeat(64),
    width,
    height,
    dataType: null,
    encoding: "fixture",
  });
  return {
    format: "rgbd-workbench/scene",
    schemaVersion: 2,
    sceneId: "550e8400-e29b-41d4-a716-446655440000",
    sceneHash: "b".repeat(64),
    name: "Fixture",
    sources: { rgb: source("rgb"), depth: source("depth") },
    geometry: {
      depth: {
        representation: "z_depth",
        unit: "m",
        scaleToMeter: null,
        invalidValues: [],
        validMin: null,
        validMax: null,
      },
      camera: {
        model: "pinhole",
        width,
        height,
        fx: width,
        fy: width,
        cx: (width - 1) / 2,
        cy: (height - 1) / 2,
        distortionModel: "none",
      },
      alignment: { state: "registered_to_rgb", method: "fixture" },
      rawDescriptor: null,
    },
    frameId: "camera",
    coordinateConvention: "x_right_y_down_z_forward",
    normalizerVersion: "2",
    decoderContractVersion: "2",
  };
}
export function rgbFixture(width = 2, height = 2): RgbImage {
  return {
    width,
    height,
    pixels: Uint8Array.from({ length: width * height * 3 }, (_, i) => (i * 23) % 256),
  };
}
export function depthFixture(width = 2, height = 2): NumericArray {
  return {
    width,
    height,
    dataType: "float32",
    data: Float32Array.from({ length: width * height }, (_, i) => 1 + i * 0.1),
  };
}
export function png(width = 2, height = 2): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let i = 0; i < bytes.length; i += 4) {
    bytes[i] = 255;
    bytes[i + 1] = (i / 4) % 255;
    bytes[i + 3] = 255;
  }
  return new Uint8Array(deflateSync(bytes));
}
