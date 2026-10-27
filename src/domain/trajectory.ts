import { z } from "zod";
import { formatSchema, positiveIntegerSchema, positiveSchema, vector3Schema } from "./common";

export const projectionSchema = z
  .object({
    projection: z.enum(["perspective", "orthographic"]),
    fov: z.number().min(1).max(179),
    orthoScale: positiveSchema,
  })
  .strict();
export const cameraPoseSchema = z
  .object({
    position: vector3Schema,
    target: vector3Schema,
    up: vector3Schema,
    ...projectionSchema.shape,
  })
  .strict();
export const keyframeSchema = cameraPoseSchema
  .extend({
    time: z.number().nonnegative(),
    easing: z.enum(["linear", "smoothstep", "ease_in_out_cubic"]),
  })
  .strict();
export const cameraPathSchema = z
  .object({
    ...formatSchema("camera-path", 2),
    samplerVersion: z.literal("2.0.0"),
    unit: z.enum(["m", "unitless"]),
    frameId: z.string().min(1).max(128),
    targetSource: z
      .object({
        kind: z.enum(["scene_median", "roi_median", "selected_point", "manual"]),
        pixelIndex: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    kind: z.enum([
      "orbit",
      "ellipse",
      "dolly",
      "truck",
      "pedestal",
      "tilt_pan",
      "spiral",
      "flythrough",
      "dolly_zoom",
      "custom",
    ]),
    duration: z.number().min(0.1).max(120),
    loopMode: z.enum(["once", "loop"]),
    target: vector3Schema,
    radius: positiveSchema,
    turns: z.number().min(0.01).max(100),
    elevation: z.number().min(-89).max(89),
    distanceScale: positiveSchema,
    easing: z.enum(["linear", "smoothstep", "ease_in_out_cubic"]),
    projection: projectionSchema,
    keyframes: z.array(keyframeSchema).max(256),
  })
  .strict()
  .superRefine((path, ctx) => {
    if (path.kind === "custom") {
      if (
        path.keyframes.length < 2 ||
        path.keyframes[0]?.time !== 0 ||
        path.keyframes.at(-1)?.time !== path.duration
      )
        ctx.addIssue({ code: "custom", message: "custom keyframes must cover duration" });
      for (let i = 1; i < path.keyframes.length; i += 1)
        if (path.keyframes[i]!.time <= path.keyframes[i - 1]!.time)
          ctx.addIssue({ code: "custom", message: "keyframe times must increase" });
    }
  });
export const renderSpecSchema = z
  .object({
    ...formatSchema("render-spec", 2),
    layout: z.enum(["pointcloud", "rgb_depth_pointcloud"]),
    width: positiveIntegerSchema.min(2).max(4096),
    height: positiveIntegerSchema.min(2).max(4096),
    fps: positiveIntegerSchema.min(1).max(60),
    codec: z.enum(["avc", "vp9", "png"]),
    quality: z.enum(["low", "medium", "high"]),
    background: z.enum(["dark", "light"]),
    pointSize: z.number().min(0.5).max(12),
    antiAlias: z.union([z.literal(1), z.literal(2)]),
    colorMode: z.enum(["rgb", "depth", "mono", "validity"]),
    colorMap: z.enum(["turbo", "viridis", "inferno", "magma", "plasma", "cividis", "gray"]),
    colorRange: z.object({ min: z.number().finite(), max: z.number().finite() }).strict(),
    maxPoints: positiveIntegerSchema.max(2_000_000),
    overlays: z
      .object({
        axes: z.boolean(),
        grid: z.boolean(),
        title: z.boolean(),
        unit: z.boolean(),
        time: z.boolean(),
        provenance: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((render, ctx) => {
    if (render.codec !== "png" && (render.width % 2 !== 0 || render.height % 2 !== 0))
      ctx.addIssue({ code: "custom", message: "video dimensions must be even" });
    if (render.colorRange.min >= render.colorRange.max)
      ctx.addIssue({ code: "custom", message: "color range must be increasing" });
    if (render.width * render.height * render.antiAlias ** 2 > 16_777_216)
      ctx.addIssue({ code: "custom", message: "frame memory exceeds budget" });
  });
export const exportJobSchema = z
  .object({
    ...formatSchema("export-job", 2),
    jobId: z.uuid(),
    derivationKey: z.string().regex(/^[a-f0-9]{64}$/),
    cameraPath: cameraPathSchema,
    render: renderSpecSchema,
    status: z.enum([
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelling",
      "cancelled",
      "interrupted",
    ]),
    frameCount: positiveIntegerSchema,
    progress: z.number().min(0).max(1),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  })
  .strict()
  .superRefine((job, ctx) => {
    if (
      (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") &&
      job.completedAt === null
    )
      ctx.addIssue({ code: "custom", message: "terminal jobs need completedAt" });
    if (job.status === "succeeded" && job.progress !== 1)
      ctx.addIssue({ code: "custom", message: "succeeded jobs need full progress" });
  });
export type CameraPath = z.infer<typeof cameraPathSchema>;
export type CameraPose = z.infer<typeof cameraPoseSchema>;
export type Keyframe = z.infer<typeof keyframeSchema>;
export type RenderSpec = z.infer<typeof renderSpecSchema>;
export type ExportJob = z.infer<typeof exportJobSchema>;
