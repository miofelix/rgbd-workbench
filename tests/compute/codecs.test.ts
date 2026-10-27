import { describe, expect, it } from "vitest";
import { parseNpy, parseNpz } from "@/compute/codecs/npy";
import { parsePfm, parseRaw } from "@/compute/codecs/raw-depth";
import { npyFloat32 } from "../fixtures/rgbd";
import { zipSync } from "fflate";
describe("bounded numeric decoders", () => {
  it("decodes NPY and single-member NPZ", () => {
    const data = npyFloat32([1, 2, 3, 4], [2, 2]);
    expect([...parseNpy(data).data]).toEqual([1, 2, 3, 4]);
    expect(parseNpz(zipSync({ "depth.npy": data })).height).toBe(2);
    expect(() => parseNpz(zipSync({ "a.npy": data, "b.npy": data }))).toThrow(/one explicitly/);
  });
  it("decodes bottom-up PFM and rejects invalid payload", () => {
    const text = new TextEncoder().encode("Pf\n2 2\n-1\n");
    const data = new Uint8Array(text.length + 16);
    data.set(text);
    const view = new DataView(data.buffer);
    [3, 4, 1, 2].forEach((value, index) => view.setFloat32(text.length + index * 4, value, true));
    expect([...parsePfm(data).data]).toEqual([1, 2, 3, 4]);
    expect(() => parsePfm(new TextEncoder().encode("PF\n2 2\n-1\n"))).toThrow();
  });
  it("enforces RAW descriptors and endian conversion", () => {
    const bytes = Uint8Array.from([63, 128, 0, 0]);
    expect(parseRaw(bytes, { shape: [1, 1], dataType: "float32", endianness: "big" }).data[0]).toBe(
      1,
    );
    expect(() =>
      parseRaw(bytes, { shape: [1, 2], dataType: "float32", endianness: "little" }),
    ).toThrow(/length/);
  });
});
