import { z } from "zod";
import { sceneSchema } from "./scene";
import { processingSpecSchema } from "./processing";
import { derivationManifestSchema } from "./derivation";
import { diagnosticSchema } from "./diagnostics";
import { cameraPathSchema, renderSpecSchema } from "./trajectory";
import { exportManifestSchema } from "./export-manifest";
import { sourceArchiveSchema } from "./source-archive";
const definitions = {
  "scene-v2.json": sceneSchema,
  "processing-spec-v2.json": processingSpecSchema,
  "derivation-v2.json": derivationManifestSchema,
  "diagnostic-v2.json": diagnosticSchema,
  "camera-path-v2.json": cameraPathSchema,
  "render-spec-v2.json": renderSpecSchema,
  "export-v2.json": exportManifestSchema,
  "source-archive-v2.json": sourceArchiveSchema,
};
export const schemas = Object.fromEntries(
  Object.entries(definitions).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }),
  ]),
);
