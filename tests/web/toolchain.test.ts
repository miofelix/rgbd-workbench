import { describe, expect, it } from "vitest";

describe("frontend toolchain", () => {
  it("loads a strict TypeScript entrypoint", async () => {
    const module = await import("../../web/src/main");

    expect(module).toHaveProperty("mountRgbdLab");
  });
});
