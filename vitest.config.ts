import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    env: { NODE_OPTIONS: "--experimental-vm-modules" },
    pool: "forks",
    setupFiles: ["tests/setup/browser-globals.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**"],
    maxWorkers: 1,
    coverage: { provider: "v8", reporter: ["text", "html"] },
  },
});
