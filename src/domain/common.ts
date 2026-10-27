import { z } from "zod";

export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const sceneIdSchema = z.uuid();
export const finiteSchema = z.number().finite();
export const positiveSchema = finiteSchema.positive();
export const safeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const positiveIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const vector3Schema = z.tuple([finiteSchema, finiteSchema, finiteSchema]);
export const byteSizeSchema = safeIntegerSchema.max(2 * 1024 * 1024 * 1024);
export const formatSchema = <Kind extends string>(kind: Kind, version: number) => ({
  format: z.literal(`rgbd-workbench/${kind}`),
  schemaVersion: z.literal(version),
});

export type Vector3 = z.infer<typeof vector3Schema>;
export type SceneId = z.infer<typeof sceneIdSchema>;
