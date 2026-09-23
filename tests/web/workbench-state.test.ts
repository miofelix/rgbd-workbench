import { describe, expect, it } from "vitest";

import { useWorkbenchStore } from "../../web/src/state/workbench";
import type { SceneSummary } from "../../web/src/api/types";

const scene = (id: string): SceneSummary => ({
  schema_version: 1,
  scene_id: id,
  display_name: id,
  rgb: { source_id: `${id}-rgb`, role: "rgb", filename: "rgb.png", sha256_prefix: "a", size_bytes: 1, width: 2, height: 2, dtype: "uint8" },
  depth: { source_id: `${id}-depth`, role: "depth", filename: "depth.npy", sha256_prefix: "b", size_bytes: 1, width: 2, height: 2, dtype: "float32" },
  depth_spec: { representation: "relative_z", unit: "unitless", invalid_values: [], valid_min: null, valid_max: null, scale_to_meter: null },
  camera: null,
  alignment: null,
  frame_id: "camera",
  coordinate_convention: "x_right_y_down_z_forward",
  normalizer_version: "1",
  adapter_versions: { rgb: "1", depth: "1" },
  capabilities: { image_inspection: true, relative_pointcloud: true, metric_pointcloud: false, video_export: false },
});

describe("workbench store", () => {
  it("keeps the newest scene response when older requests resolve later", async () => {
    useWorkbenchStore.getState().reset();
    let resolveFirst!: (value: SceneSummary[]) => void;
    let resolveSecond!: (value: SceneSummary[]) => void;
    const first = new Promise<SceneSummary[]>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<SceneSummary[]>((resolve) => { resolveSecond = resolve; });

    const firstLoad = useWorkbenchStore.getState().loadScenes(() => first);
    const secondLoad = useWorkbenchStore.getState().loadScenes(() => second);
    resolveSecond([scene("new")]);
    await secondLoad;
    resolveFirst([scene("old")]);
    await firstLoad;

    expect(useWorkbenchStore.getState().scenes.map((item) => item.scene_id)).toEqual(["new"]);
  });

  it("marks metric actions unavailable for relative unitless scenes", () => {
    useWorkbenchStore.getState().reset();
    useWorkbenchStore.getState().selectScene(scene("relative"));
    expect(useWorkbenchStore.getState().appliedScene?.capabilities?.metric_pointcloud).toBe(false);
    expect(useWorkbenchStore.getState().appliedScene?.depth_spec?.unit).toBe("unitless");
  });
});
