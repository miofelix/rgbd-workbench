import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deriveFixture, importFixture, shortVideoSettings } from "./helpers";
import { unzipSync } from "fflate";
import { derivationManifestSchema } from "@/domain/derivation";
import { sourceArchiveSchema } from "@/domain/source-archive";
import { exportManifestSchema } from "@/domain/export-manifest";

test("imports, derives, exports, and restores an applied scene", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
    console.error("PAGE ERROR", error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error("CONSOLE", message.text());
  });
  await importFixture(page);
  await deriveFixture(page);
  const plyPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 PLY" }).click();
  const ply = await plyPromise;
  expect((await readFile(await ply.path())).subarray(0, 4).toString()).toBe("ply\n");
  const jsonPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载参数 JSON" }).click();
  const json = await jsonPromise;
  const parameters = derivationManifestSchema.parse(
    JSON.parse(await readFile(await json.path(), "utf8")),
  );
  expect(parameters.unit).toBe("m");
  expect(parameters.pointCount).toBe(48);
  const pngPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 PNG" }).click();
  const png = await pngPromise;
  expect((await readFile(await png.path())).subarray(1, 4).toString()).toBe("PNG");
  await page.reload();
  await expect(page.getByText("48 点 ·").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const archivePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 Archive" }).click();
  const archive = await archivePromise;
  const archiveBytes = await readFile(await archive.path());
  const files = unzipSync(archiveBytes);
  sourceArchiveSchema.parse(JSON.parse(new TextDecoder().decode(files["archive.json"])));
  await page.setInputFiles('input[aria-label="恢复 Source Archive"]', {
    name: "backup.rgbd.zip",
    mimeType: "application/zip",
    buffer: archiveBytes,
  });
  await expect(page.getByText("正在验证并恢复 Archive")).toHaveCount(0);
  await expect(page.locator(".scene-card")).toHaveCount(2);
  expect(pageErrors).toEqual([]);
});
test("renders H264 or VP9 and deterministic PNG sequence", async ({ page, browserName }) => {
  await importFixture(page);
  await deriveFixture(page);
  await shortVideoSettings(page);
  await page.getByLabel("视频编码").selectOption("png");
  const sequencePromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PNG 序列" }).click();
  const sequence = await sequencePromise;
  const files = unzipSync(await readFile(await sequence.path()));
  expect(Object.keys(files).filter((name) => name.endsWith(".png"))).toHaveLength(6);
  const sequenceManifest = exportManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(files["export-manifest.json"])),
  );
  expect(sequenceManifest.frameCount).toBe(6);
  expect(sequenceManifest.duration).toBe(0.2);
  const codec = browserName === "webkit" ? "avc" : "vp9";
  await page.getByLabel("视频编码").selectOption(codec);
  test.skip(
    !(await page.getByRole("button", { name: "导出视频" }).isEnabled()),
    `${browserName} lacks this WebCodecs encoder`,
  );
  const videoPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出视频" }).click();
  const video = await videoPromise;
  const bundle = unzipSync(await readFile(await video.path()));
  const mediaName = Object.keys(bundle).find((name) =>
    name.endsWith(codec === "avc" ? ".mp4" : ".webm"),
  );
  const manifestName = Object.keys(bundle).find((name) => name.endsWith("-export.json"));
  expect(mediaName).toBeDefined();
  expect(manifestName).toBeDefined();
  const bytes = bundle[mediaName!]!;
  const manifest = exportManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(bundle[manifestName!])),
  );
  expect(bytes.length).toBeGreaterThan(100);
  if (codec === "avc") expect(new TextDecoder().decode(bytes.subarray(4, 8))).toBe("ftyp");
  else expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  expect(manifest.artifact.byteLength).toBe(bytes.length);
  expect(manifest.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(manifest.frameCount).toBe(6);
  expect(manifest.duration).toBe(0.2);
});
test("keeps relative geometry unitless and mobile layout contained", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await importFixture(page, true);
  await deriveFixture(page);
  await expect(page.locator(".viewer-caption")).toContainText("unitless");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
