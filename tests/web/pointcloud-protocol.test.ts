import { describe, expect, it } from "vitest";

import {
  parsePointCloudPayload,
  stableLod,
} from "../../web/src/features/pointcloud/pointcloud-protocol";
import { corruptOffsetPayload, pointcloudPayload } from "./pointcloud-fixtures";

describe("point-cloud protocol", () => {
  it("parses typed arrays without changing source point order", () => {
    const parsed = parsePointCloudPayload(pointcloudPayload());

    expect(Array.from(parsed.pixelIndex)).toEqual([0, 1]);
    expect(Array.from(parsed.colors)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(parsed.positions[0]).toBeCloseTo(-0.1);
    expect(parsed.manifest.unit).toBe("m");
  });

  it("rejects a payload whose array offset exceeds the buffer", () => {
    expect(() => parsePointCloudPayload(corruptOffsetPayload())).toThrow(
      /offset/i,
    );
  });

  it("rejects a truncated payload before typed-array construction", () => {
    const payload = pointcloudPayload();
    expect(() =>
      parsePointCloudPayload(payload.slice(0, payload.byteLength - 1)),
    ).toThrow(/payload|length/i);
  });

  it("keeps LOD source order and is stable across calls", () => {
    const first = stableLod(1_000_000, 250_000);
    const second = stableLod(1_000_000, 250_000);

    expect(Array.from(first)).toEqual(Array.from(second));
    expect(first[0]).toBe(0);
    expect(first[first.length - 1]).toBe(999_999);
    expect(
      first.every((value, index) => index === 0 || value > first[index - 1]),
    ).toBe(true);
  });
});
