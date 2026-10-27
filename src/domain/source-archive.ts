import { z } from "zod";
import { formatSchema, safeIntegerSchema, sceneIdSchema, sha256Schema } from "./common";

export const sourceArchiveSchema = z
  .object({
    ...formatSchema("source-archive", 2),
    sceneId: sceneIdSchema,
    sceneSha256: sha256Schema,
    entries: z
      .array(
        z
          .object({
            path: z
              .string()
              .regex(/^(sources\/(rgb|depth)|manifests\/source|derivations\/[a-f0-9]{64}\.bin)$/),
            byteLength: safeIntegerSchema,
            sha256: sha256Schema,
          })
          .strict(),
      )
      .min(2)
      .max(64),
  })
  .strict()
  .superRefine((archive, ctx) => {
    for (const required of ["sources/rgb", "sources/depth"])
      if (!archive.entries.some((entry) => entry.path === required))
        ctx.addIssue({ code: "custom", message: `archive is missing ${required}` });
    if (new Set(archive.entries.map((entry) => entry.path)).size !== archive.entries.length)
      ctx.addIssue({ code: "custom", message: "archive entries must be unique" });
  });
export type SourceArchiveManifest = z.infer<typeof sourceArchiveSchema>;
