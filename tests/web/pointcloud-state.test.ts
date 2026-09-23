import { beforeEach, describe, expect, it } from "vitest";

import type { DerivationResponse, SceneSummary } from "../../web/src/api/types";
import { useWorkbenchStore } from "../../web/src/state/workbench";
import { defaultProcessing, derivationResponse } from "./pointcloud-fixtures";

function scene(id: string): SceneSummary {
  return {
    schema_version: 1,
    scene_id: id,
    display_name: id,
    rgb: {
      source_id: `${id}-rgb`,
      role: "rgb",
      filename: "rgb.png",
      sha256_prefix: "a",
      size_bytes: 1,
      width: 2,
      height: 2,
      dtype: "uint8",
    },
    depth: {
      source_id: `${id}-depth`,
      role: "depth",
      filename: "depth.npy",
      sha256_prefix: "b",
      size_bytes: 1,
      width: 2,
      height: 2,
      dtype: "float32",
    },
    depth_spec: {
      representation: "z_depth",
      unit: "m",
      invalid_values: [],
      valid_min: null,
      valid_max: null,
      scale_to_meter: null,
    },
    camera: { model: "pinhole", width: 2, height: 2 },
    alignment: { state: "registered_to_rgb" },
    frame_id: "camera",
    coordinate_convention: "x_right_y_down_z_forward",
    normalizer_version: "1",
    adapter_versions: { rgb: "1", depth: "1" },
    capabilities: {
      image_inspection: true,
      relative_pointcloud: false,
      metric_pointcloud: true,
      video_export: true,
    },
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve,
  };
}

describe("point-cloud workbench state", () => {
  beforeEach(() => useWorkbenchStore.getState().reset());

  it("keeps draft processing separate from the applied derivation", async () => {
    useWorkbenchStore.getState().selectScene(scene("scene-1"));
    useWorkbenchStore
      .getState()
      .setDraftProcessing({ ...defaultProcessing, pixel_stride: 2 });
    expect(useWorkbenchStore.getState().appliedProcessing).toBeNull();

    await useWorkbenchStore
      .getState()
      .applyProcessing(async () => derivationResponse("scene-1"));

    expect(useWorkbenchStore.getState().appliedProcessing?.pixel_stride).toBe(
      2,
    );
    expect(useWorkbenchStore.getState().appliedDerivation?.scene_id).toBe(
      "scene-1",
    );
  });

  it("does not let a late derivation response replace a newer Scene", async () => {
    const oldResult = deferred<DerivationResponse>();
    const newResult = deferred<DerivationResponse>();
    useWorkbenchStore.getState().selectScene(scene("old-scene"));
    const oldApply = useWorkbenchStore
      .getState()
      .applyProcessing(() => oldResult.promise);

    useWorkbenchStore.getState().selectScene(scene("new-scene"));
    const newApply = useWorkbenchStore
      .getState()
      .applyProcessing(() => newResult.promise);
    newResult.resolve(derivationResponse("new-scene"));
    await newApply;
    oldResult.resolve(derivationResponse("old-scene"));
    await oldApply;

    expect(useWorkbenchStore.getState().appliedDerivation?.scene_id).toBe(
      "new-scene",
    );
  });

  it("clears selections and applied geometry when the Scene changes", async () => {
    useWorkbenchStore.getState().selectScene(scene("scene-1"));
    await useWorkbenchStore
      .getState()
      .applyProcessing(async () => derivationResponse("scene-1"));
    useWorkbenchStore
      .getState()
      .selectPoint({ pixelIndex: 0, position: [0, 0, 1], unit: "m" });

    useWorkbenchStore.getState().selectScene(scene("scene-2"));

    expect(useWorkbenchStore.getState().appliedDerivation).toBeNull();
    expect(useWorkbenchStore.getState().selectedPoints).toEqual([]);
  });
});
