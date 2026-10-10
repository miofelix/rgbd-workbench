import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./tests/e2e",
  // E2E cases share the local service token and workspace; parallel workers race on imports.
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8765",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "PYTHONPATH=src RGBD_WORKBENCH_SESSION_TOKEN=e2e-token .venv/bin/python -m rgbd_workbench.cli.main serve --no-open --port 8765",
    env: {
      RGBD_WORKBENCH_WORKSPACE_ROOT: mkdtempSync(join(tmpdir(), "rgbd-e2e-")),
    },
    url: "http://127.0.0.1:8765/api/v1/health",
    reuseExistingServer: false,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
