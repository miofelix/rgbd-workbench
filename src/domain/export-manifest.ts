import { z } from "zod";
import { formatSchema, positiveIntegerSchema, safeIntegerSchema, sha256Schema } from "./common";
import { cameraPathSchema, renderSpecSchema } from "./trajectory";
import { derivationManifestSchema } from "./derivation";
import { diagnosticSchema } from "./diagnostics";
export const exportManifestSchema = z
  .object({
    ...formatSchema("export", 2),
    exportId: z.uuid(),
    sceneId: z.uuid(),
    derivation: derivationManifestSchema,
    cameraPath: cameraPathSchema.nullable(),
    render: renderSpecSchema.nullable(),
    artifact: z
      .object({
        kind: z.enum(["ply", "parameters", "png", "video", "frames", "source-archive"]),
        mediaType: z.string(),
        byteLength: safeIntegerSchema,
        sha256: sha256Schema,
      })
      .strict(),
    frameCount: positiveIntegerSchema.nullable(),
    duration: z.number().nonnegative().nullable(),
    createdAt: z.iso.datetime(),
    rendererVersion: z.string(),
    encoder: z.string().nullable(),
    diagnostics: z.array(diagnosticSchema),
  })
  .strict();
export type ExportManifest = z.infer<typeof exportManifestSchema>;
