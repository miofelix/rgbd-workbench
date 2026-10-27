import { expect, type Page } from "@playwright/test";
import { encode } from "fast-png";
import { npyFloat32 } from "../fixtures/rgbd";
export const WIDTH = 8;
export const HEIGHT = 6;
export function rgbBytes(): Uint8Array {
  const data = new Uint8Array(WIDTH * HEIGHT * 3);
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    data[i * 3] = 30 + i * 3;
    data[i * 3 + 1] = 180 - i * 2;
    data[i * 3 + 2] = 60 + i * 4;
  }
  return encode({ width: WIDTH, height: HEIGHT, data, channels: 3, depth: 8 });
}
export function depthBytes(): Uint8Array {
  return npyFloat32(
    Array.from({ length: WIDTH * HEIGHT }, (_, i) => 1 + (i % WIDTH) * 0.02),
    [HEIGHT, WIDTH],
  );
}
export function manifest(relative = false): string {
  return JSON.stringify({
    display_name: relative ? "Relative Browser Fixture" : "Metric Browser Fixture",
    representation: relative ? "relative_z" : "z_depth",
    unit: relative ? "unitless" : "m",
    camera: {
      model: "pinhole",
      width: WIDTH,
      height: HEIGHT,
      fx: WIDTH,
      fy: WIDTH,
      cx: (WIDTH - 1) / 2,
      cy: (HEIGHT - 1) / 2,
      distortion_model: "none",
    },
    alignment: { state: "registered_to_rgb" },
  });
}
export async function importFixture(page: Page, relative = false): Promise<void> {
  await page.goto("/");
  await page.setInputFiles('input[aria-label="RGB 图像文件"]', {
    name: "rgb.png",
    mimeType: "image/png",
    buffer: Buffer.from(rgbBytes()),
  });
  await page.setInputFiles('input[aria-label="深度数据文件"]', {
    name: "depth.npy",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(depthBytes()),
  });
  await page.setInputFiles('input[aria-label="可选 manifest 文件"]', {
    name: "scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(manifest(relative)),
  });
  await expect(page.getByLabel("确认几何合同")).toBeVisible();
  await page.getByLabel("确认几何合同").check();
  await expect(page.getByRole("button", { name: "保存 Scene" })).toBeEnabled();
  await page.getByRole("button", { name: "保存 Scene" }).click();
  await expect(
    page.getByRole("heading", {
      name: relative ? "Relative Browser Fixture" : "Metric Browser Fixture",
    }),
  ).toBeVisible();
  await expect(page.getByText("正在保存 Scene")).toHaveCount(0);
}
export async function deriveFixture(page: Page): Promise<void> {
  await page.getByRole("button", { name: "应用处理", exact: true }).click();
  await expect(page.getByText(`${WIDTH * HEIGHT} 点 ·`).first()).toBeVisible();
  await expect(page.getByTestId("pointcloud-canvas")).toBeVisible();
}
export async function shortVideoSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: /轨迹与导出/ }).click();
  await page.getByLabel("轨迹时长").fill("0.2");
  await page.getByRole("button", { name: "应用轨迹" }).click();
  await page.getByLabel("视频宽度").fill("320");
  await page.getByLabel("视频高度").fill("240");
}
