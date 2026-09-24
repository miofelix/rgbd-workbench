import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:8765",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "PYTHONPATH=src RGBD_WORKBENCH_SESSION_TOKEN=e2e-token .venv/bin/python -m rgbd_workbench.cli.main serve --workspace-root workspace --no-open --port 8765",
    url: "http://127.0.0.1:8765/api/v1/health",
    reuseExistingServer: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
