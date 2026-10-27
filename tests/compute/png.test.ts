import { describe, expect, it } from "vitest";
import { decodePngDepth, decodePngRgb, encodePng, encodePng16 } from "@/compute/codecs/png";
import { rgbFixture } from "../fixtures/rgbd";
describe("deterministic PNG codecs", () => {
  it("round-trips RGB and 16-bit grayscale depth", () => {
    const rgb = rgbFixture();
    expect(decodePngRgb(encodePng(rgb.pixels, 2, 2)).pixels).toEqual(rgb.pixels);
    const depth = Uint16Array.from([0, 1, 65535, 1000]);
    const decoded = decodePngDepth(encodePng16(depth, 2, 2));
    expect(decoded.dataType).toBe("uint16");
    expect(decoded.data).toEqual(depth);
  });
});
