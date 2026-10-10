import { describe, expect, it } from "vitest";

import type { ProcessingSpec } from "../../web/src/api/types";
import { validateProcessing } from "../../web/src/features/pointcloud/processing-validation";
import { DEFAULT_PROCESSING } from "../../web/src/state/workbench";

describe("processing validation", () => {
  it("accepts contract boundaries and independent XYZ limits", () => {
    expect(
      validateProcessing(
        {
          ...DEFAULT_PROCESSING,
          pixel_stride: 32,
          max_points: 100,
          roi: [0, 0, 640, 480],
          depth_min: 0.001,
          depth_max: 0.001,
          xyz_min: [-1, 0, 1],
          xyz_max: [-1, 0, 1],
          knn_filter: { k: 64, std_ratio: 0 },
          knn_smooth: { k: 1 },
        },
        640,
        480,
      ),
    ).toEqual([]);
    expect(
      validateProcessing(
        { ...DEFAULT_PROCESSING, xyz_max: [1, 1, 10] },
        640,
        480,
      ),
    ).toEqual([]);
  });

  it.each<[Partial<ProcessingSpec>, string]>([
    [{ pixel_stride: 0 }, "pixel_stride"],
    [{ pixel_stride: 1.5 }, "pixel_stride"],
    [{ max_points: 99 }, "max_points"],
    [{ max_points: 2_000_001 }, "max_points"],
    [{ max_points: Number.NaN }, "max_points"],
    [{ depth_min: 0 }, "depth_min"],
    [{ depth_max: Number.POSITIVE_INFINITY }, "depth_max"],
    [{ depth_min: 2, depth_max: 1 }, "depth_max"],
    [{ voxel_size: -1 }, "voxel_size"],
    [{ roi: [0, 0, 641, 480] }, "roi.2"],
    [{ roi: [0, 0, 640, 481] }, "roi.3"],
    [{ roi: [-1, 0, 640, 480] }, "roi.0"],
    [{ roi: [0.5, 0, 640, 480] }, "roi.0"],
    [{ roi: [100, 0, 100, 480] }, "roi.2"],
    [{ roi: [0, 480, 640, 0] }, "roi.3"],
    [{ xyz_min: [Number.NaN, 0, 0] }, "xyz_min.0"],
    [{ xyz_min: [0, 1, 0], xyz_max: [1, 0, 1] }, "xyz_max.1"],
    [{ knn_filter: { k: 1.5, std_ratio: 2 } }, "knn_filter.k"],
    [{ knn_filter: { k: 16, std_ratio: 5.1 } }, "knn_filter.std_ratio"],
    [{ knn_smooth: { k: 65 } }, "knn_smooth.k"],
  ])("rejects an invalid %s draft", (patch, field) => {
    expect(
      validateProcessing({ ...DEFAULT_PROCESSING, ...patch }, 640, 480),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ field })]));
  });
});
