import { expect, test } from "@playwright/test";
import { deriveFixture, importFixture, shortVideoSettings } from "./helpers";
import { unzipSync } from "fflate";
import { readFile } from "node:fs/promises";

test("edits keyframes and exports the split-layout video", async ({ page }) => {
  await importFixture(page);
  await deriveFixture(page);
  await shortVideoSettings(page);
  await page.getByRole("button", { name: "添加当前视角" }).click();
  await page.getByRole("button", { name: "添加当前视角" }).click();
  await expect(page.getByText("K1", { exact: true })).toBeVisible();
  await expect(page.getByText("K2", { exact: true })).toBeVisible();
  await page.getByLabel("关键帧 1 target x").fill("0.1");
  await page.getByRole("button", { name: "应用轨迹" }).click();
  await expect(page.locator(".job-status")).toContainText("尚未创建导出任务");
  await page.getByLabel("视频版式").selectOption("rgb_depth_pointcloud");
  await page.getByLabel("视频编码").selectOption("png");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PNG 序列" }).click();
  const download = await downloadPromise;
  const files = unzipSync(await readFile(await download.path()));
  expect(files["export-manifest.json"]).toBeDefined();
  expect(Object.keys(files).filter((name) => name.endsWith(".png"))).toHaveLength(6);
});

test("cancels a long render without publishing a download", async ({ page }) => {
  await importFixture(page);
  await deriveFixture(page);
  await page.getByRole("button", { name: /轨迹与导出/ }).click();
  await page.getByLabel("轨迹时长").fill("120");
  await page.getByRole("button", { name: "应用轨迹" }).click();
  await page.getByLabel("视频编码").selectOption("png");
  await page.getByLabel("渲染点数上限").fill("2000000");
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  await page.getByRole("button", { name: "导出 PNG 序列" }).click();
  await expect(page.getByRole("button", { name: "取消导出" })).toBeVisible();
  await page.getByRole("button", { name: "取消导出" }).click();
  await expect(page.getByTestId("export-error")).toHaveText("操作已取消。");
  await page.waitForTimeout(250);
  await expect(page.getByRole("button", { name: "取消导出" })).toHaveCount(0);
  expect(downloads).toBe(0);
});
