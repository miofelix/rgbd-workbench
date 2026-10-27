import { describe, expect, it } from "vitest";
import { blobBytes } from "@/shared/binary";

describe("portable binary reads", () => {
  it("preserves bytes with native or fallback Blob readers", async () => {
    const expected = Uint8Array.from([82, 71, 66, 68, 80, 67, 50, 0, 12, 0, 0, 0]);
    const actual = new Uint8Array(await blobBytes(new Blob([expected.slice().buffer])));
    expect(actual).toEqual(expected);
  });
});
