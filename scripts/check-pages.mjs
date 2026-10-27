import { spawn } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = new URL("../", import.meta.url).pathname;
const staging = new URL("../../tmp/rgbd-pages-check/", import.meta.url).pathname;
const port = Number(process.env.PAGES_CHECK_PORT ?? 4180);
const base = process.env.VITE_BASE ?? "/rgbd-workbench/";
if (!base.startsWith("/") || !base.endsWith("/"))
  throw new Error("VITE_BASE must be an absolute path ending in /");
let server;
try {
  const build = spawn("npm", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, VITE_BASE: base },
  });
  if ((await new Promise((resolve) => build.once("exit", resolve))) !== 0)
    throw new Error("production build failed");
  await mkdir(staging, { recursive: true });
  await cp(new URL("../dist/", import.meta.url), staging + base.replace(/^\//, ""), {
    recursive: true,
  });
  server = spawn(
    "python3",
    ["-m", "http.server", String(port), "--bind", "127.0.0.1", "--directory", staging],
    { stdio: "ignore" },
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  const url = `http://127.0.0.1:${port}${base}`;
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  const { deriveFixture, importFixture } = await vite.ssrLoadModule("/tests/e2e/helpers.ts");
  await vite.close();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ baseURL: url });
  if (base !== "/")
    await page.route(`http://127.0.0.1:${port}/`, (route) =>
      route.fulfill({ status: 301, headers: { location: base } }),
    );
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await importFixture(page);
  await deriveFixture(page);
  console.log(
    JSON.stringify(
      {
        url: page.url(),
        pointcloud: await page.locator(".viewer-caption").textContent(),
        failures,
      },
      null,
      2,
    ),
  );
  await browser.close();
  if (failures.length) throw new Error("Pages verification failed");
} finally {
  server?.kill();
  await rm(staging, { recursive: true, force: true });
}
