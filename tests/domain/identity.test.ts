import { describe, expect, it } from "vitest";
import { canonicalJson, derivationKey, sceneHash, withSceneHash } from "@/domain/identity";
import { DEFAULT_PROCESSING } from "@/domain/processing";
import { diagnostic, diagnosticText } from "@/domain/diagnostics";
import { sceneSchema } from "@/domain/scene";
import { metricScene } from "../fixtures/rgbd";
describe("public identity and schemas", () => {
  it("canonicalizes JCS object keys and rejects invalid Scene roles", async () => {
    expect(canonicalJson({ z: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"z":1}');
    expect(sceneSchema.safeParse(metricScene()).success).toBe(true);
    expect(await derivationKey("a".repeat(64), DEFAULT_PROCESSING, "2.0.0")).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(
      diagnosticText(diagnostic("DEPTH_SEMANTICS_REQUIRED", "warning", "depth.semanticsRequired")),
    ).toContain("单位");
    const scene = await withSceneHash(metricScene());
    const serialized = JSON.parse(JSON.stringify(scene)) as typeof scene;
    expect(await sceneHash(serialized)).toBe(scene.sceneHash);
  });
});
