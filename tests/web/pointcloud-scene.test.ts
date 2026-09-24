import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { parsePointCloudPayload } from "../../web/src/features/pointcloud/pointcloud-protocol";
import {
  selectedPointForPixel,
  setNormalizedColorBytes,
} from "../../web/src/viewer/pointcloud-scene";
import { pointcloudPayload } from "./pointcloud-fixtures";

describe("point-cloud Three.js scene", () => {
  it("preserves byte colors when writing a normalized Uint8 attribute", () => {
    const bytes = new Uint8Array(3);
    const attribute = new THREE.BufferAttribute(bytes, 3, true);

    setNormalizedColorBytes(attribute, 0, [20, 40, 60]);

    expect(Array.from(bytes)).toEqual([20, 40, 60]);
  });

  it("maps an image pixel to the nearest representative point", () => {
    const parsed = parsePointCloudPayload(pointcloudPayload());

    const selected = selectedPointForPixel(parsed, 3);

    expect(selected).toEqual({
      pixelIndex: 1,
      position: [0, -0.20000000298023224, 2],
      unit: "m",
    });
  });
});
