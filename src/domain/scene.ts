import { z } from "zod";
import {
  byteSizeSchema,
  finiteSchema,
  formatSchema,
  positiveIntegerSchema,
  positiveSchema,
  sceneIdSchema,
  sha256Schema,
} from "./common";
import { diagnosticSchema, type Diagnostic } from "./diagnostics";
import { DTYPE_INFO, type NumericDataType } from "./codec-registry";

export const sourceDescriptorSchema = z
  .object({
    ...formatSchema("source", 2),
    role: z.enum(["rgb", "depth"]),
    name: z.string().min(1).max(255),
    mediaType: z.string().max(128).nullable(),
    byteLength: byteSizeSchema,
    sha256: sha256Schema,
    width: positiveIntegerSchema.nullable(),
    height: positiveIntegerSchema.nullable(),
    dataType: z.string().max(64).nullable(),
    encoding: z.string().max(64),
  })
  .strict()
  .check((ctx) => {
    const source = ctx.value;
    if ((source.width === null) !== (source.height === null)) {
      ctx.issues.push({
        code: "custom",
        message: "width and height must be paired",
        input: source,
      });
    }
  });
export const depthSemanticsSchema = z
  .object({
    representation: z.enum(["z_depth", "relative_z"]),
    unit: z.enum(["m", "mm", "unitless"]),
    scaleToMeter: positiveSchema.nullable(),
    invalidValues: z.array(finiteSchema).max(64),
    validMin: positiveSchema.nullable(),
    validMax: positiveSchema.nullable(),
  })
  .strict()
  .superRefine((depth, ctx) => {
    if (depth.representation === "z_depth") {
      if (depth.unit === "unitless")
        ctx.addIssue({ code: "custom", message: "z_depth requires metric units" });
      if (depth.scaleToMeter !== null && depth.unit !== "m")
        ctx.addIssue({ code: "custom", message: "unit and scale are mutually exclusive" });
    } else if (depth.unit !== "unitless" || depth.scaleToMeter !== null) {
      ctx.addIssue({ code: "custom", message: "relative_z requires unitless and no metric scale" });
    }
    if (depth.validMin !== null && depth.validMax !== null && depth.validMin > depth.validMax) {
      ctx.addIssue({ code: "custom", message: "validMin must not exceed validMax" });
    }
  });
export const cameraSchema = z
  .object({
    model: z.literal("pinhole"),
    width: positiveIntegerSchema.max(32768),
    height: positiveIntegerSchema.max(32768),
    fx: positiveSchema,
    fy: positiveSchema,
    cx: finiteSchema,
    cy: finiteSchema,
    distortionModel: z.literal("none"),
  })
  .strict();
export const alignmentSchema = z
  .object({
    state: z.enum(["registered_to_rgb", "unregistered", "unknown"]),
    method: z.string().max(128).nullable(),
  })
  .strict();
export const rawDescriptorSchema = z
  .object({
    shape: z.tuple([positiveIntegerSchema, positiveIntegerSchema]),
    dataType: z.enum(Object.keys(DTYPE_INFO) as [NumericDataType, ...NumericDataType[]]),
    endianness: z.enum(["little", "big"]),
  })
  .strict();
export const geometryContractSchema = z
  .object({
    depth: depthSemanticsSchema,
    camera: cameraSchema.nullable(),
    alignment: alignmentSchema,
    rawDescriptor: rawDescriptorSchema.nullable(),
  })
  .strict();
export const sceneSchema = z
  .object({
    ...formatSchema("scene", 2),
    sceneId: sceneIdSchema,
    sceneHash: sha256Schema,
    name: z.string().trim().min(1).max(255),
    sources: z.object({ rgb: sourceDescriptorSchema, depth: sourceDescriptorSchema }).strict(),
    geometry: geometryContractSchema,
    frameId: z.string().min(1).max(128),
    coordinateConvention: z.literal("x_right_y_down_z_forward"),
    normalizerVersion: z.string().min(1).max(64),
    decoderContractVersion: z.string().min(1).max(64),
  })
  .strict()
  .check((ctx) => {
    if (ctx.value.sources.rgb.role !== "rgb" || ctx.value.sources.depth.role !== "depth") {
      ctx.issues.push({ code: "custom", message: "source roles are invalid", input: ctx.value });
    }
  });
export const scenePreparationSchema = z.object({
  sources: z.object({ rgb: sourceDescriptorSchema, depth: sourceDescriptorSchema }),
  diagnostics: z.array(diagnosticSchema),
  suggestedGeometry: geometryContractSchema.partial({
    camera: true,
    alignment: true,
    rawDescriptor: true,
  }),
});
export type SourceDescriptor = z.infer<typeof sourceDescriptorSchema>;
export type GeometryContract = z.infer<typeof geometryContractSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type ScenePreparation = {
  sources: { rgb: SourceDescriptor; depth: SourceDescriptor };
  diagnostics: Diagnostic[];
  suggestedGeometry: Partial<GeometryContract>;
};
