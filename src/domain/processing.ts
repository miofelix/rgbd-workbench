import { z } from "zod";
import { formatSchema, positiveSchema, vector3Schema } from "./common";

export const processingSpecSchema = z
  .object({
    ...formatSchema("processing-spec", 2),
    roi: z
      .tuple([
        z.number().int().nonnegative(),
        z.number().int().nonnegative(),
        z.number().int().positive(),
        z.number().int().positive(),
      ])
      .nullable(),
    depthMin: positiveSchema.nullable(),
    depthMax: positiveSchema.nullable(),
    xyzMin: vector3Schema.nullable(),
    xyzMax: vector3Schema.nullable(),
    pixelStride: z.number().int().min(1).max(1024),
    maxPoints: z.number().int().min(100).max(2_000_000),
    voxelSize: positiveSchema.nullable(),
    knnFilter: z
      .object({ k: z.number().int().min(1).max(64), stdRatio: z.number().min(0).max(5) })
      .strict()
      .nullable(),
    knnSmooth: z
      .object({ k: z.number().int().min(1).max(64) })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((processing, ctx) => {
    if (
      processing.roi &&
      (processing.roi[0] >= processing.roi[2] || processing.roi[1] >= processing.roi[3])
    ) {
      ctx.addIssue({ code: "custom", message: "ROI must be a non-empty rectangle" });
    }
    if (
      processing.depthMin !== null &&
      processing.depthMax !== null &&
      processing.depthMin > processing.depthMax
    ) {
      ctx.addIssue({ code: "custom", message: "depthMin must not exceed depthMax" });
    }
    if (
      processing.xyzMin &&
      processing.xyzMax &&
      processing.xyzMin.some((v, i) => v > processing.xyzMax![i]!)
    ) {
      ctx.addIssue({ code: "custom", message: "xyzMin must not exceed xyzMax" });
    }
  });
export type ProcessingSpec = z.infer<typeof processingSpecSchema>;
export const DEFAULT_PROCESSING: ProcessingSpec = {
  format: "rgbd-workbench/processing-spec",
  schemaVersion: 2,
  roi: null,
  depthMin: null,
  depthMax: null,
  xyzMin: null,
  xyzMax: null,
  pixelStride: 1,
  maxPoints: 2_000_000,
  voxelSize: null,
  knnFilter: null,
  knnSmooth: null,
};
export function freshProcessing(): ProcessingSpec {
  return structuredClone(DEFAULT_PROCESSING);
}
