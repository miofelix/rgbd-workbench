import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const check = process.argv.includes("--check");
const root = fileURLToPath(new URL("../", import.meta.url));
const { createServer } = await import("vite");
const { format } = await import("prettier");
const vite = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});
const { schemas } = await vite.ssrLoadModule("/src/domain/export-schemas.ts");
await vite.close();
mkdirSync(join(root, "schemas"), { recursive: true });
const stale = [];
for (const [name, schema] of Object.entries(schemas)) {
  const content = await format(JSON.stringify(schema, null, 2), {
    parser: "json",
    printWidth: 100,
    singleQuote: false,
    trailingComma: "all",
  });
  const target = join(root, "schemas", name);
  if (check && readFileSync(target, "utf8") !== content) stale.push(name);
  if (!check) writeFileSync(target, content);
}
if (stale.length) throw new Error(`Schemas are out of date: ${stale.join(", ")}`);
