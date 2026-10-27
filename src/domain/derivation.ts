import { z } from "zod";
import {
  finiteSchema,
  formatSchema,
  positiveIntegerSchema,
  safeIntegerSchema,
  sceneIdSchema,
  sha256Schema,
} from "./common";
import { processingSpecSchema } from "./processing";

export const arrayDescriptorSchema = z
  .object({
    dataType: z.enum(["float32", "uint8", "uint32"]),
    shape: z.array(positiveIntegerSchema).min(1).max(2),
    byteOffset: safeIntegerSchema,
    byteLength: safeIntegerSchema,
  })
  .strict();
export const derivationManifestSchema = z
  .object({
    ...formatSchema("derivation", 2),
    derivationKey: sha256Schema,
    sceneId: sceneIdSchema,
    sceneHash: sha256Schema,
    processorVersion: z.string().min(1).max(64),
    processing: processingSpecSchema,
    pointCount: positiveIntegerSchema.max(2_000_000),
    sourceShape: z.tuple([positiveIntegerSchema, positiveIntegerSchema]),
    frameId: z.string().min(1).max(128),
    unit: z.enum(["m", "unitless"]),
    representation: z.enum(["z_depth", "relative_z"]),
    bounds: z
      .object({
        min: z.tuple([finiteSchema, finiteSchema, finiteSchema]),
        max: z.tuple([finiteSchema, finiteSchema, finiteSchema]),
      })
      .strict(),
    arrays: z
      .object({
        positions: arrayDescriptorSchema,
        colors: arrayDescriptorSchema,
        sourcePixelIndex: arrayDescriptorSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const valid = (manifest.representation === "z_depth") === (manifest.unit === "m");
    if (!valid)
      ctx.addIssue({ code: "custom", message: "representation and unit are inconsistent" });
    const expected: Record<string, { dataType: string; shape: number[] }> = {
      positions: { dataType: "float32", shape: [manifest.pointCount, 3] },
      colors: { dataType: "uint8", shape: [manifest.pointCount, 3] },
      sourcePixelIndex: { dataType: "uint32", shape: [manifest.pointCount] },
    };
    for (const [key, value] of Object.entries(expected)) {
      const descriptor = manifest.arrays[key as keyof typeof manifest.arrays];
      if (
        descriptor.dataType !== value.dataType ||
        descriptor.shape.join() !== value.shape.join()
      ) {
        ctx.addIssue({ code: "custom", message: `${key} descriptor is inconsistent` });
      }
    }
  });
export type DerivationManifest = z.infer<typeof derivationManifestSchema>;
export type ArrayDescriptor = z.infer<typeof arrayDescriptorSchema>;
export interface PointCloudBuffer {
  manifest: DerivationManifest;
  positions: Float32Array;
  colors: Uint8Array;
  sourcePixelIndex: Uint32Array;
}
