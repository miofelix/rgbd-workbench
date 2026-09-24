import { expect, type Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const rgbPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMU0bBhYGBgYgADAAWiAHylyrQdAAAAAElFTkSuQmCC",
  "base64",
);

function npyFloat32(values: number[], shape: [number, number]): Buffer {
  const dictionary = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape[0]}, ${shape[1]}), }`;
  const padding = (16 - ((10 + dictionary.length + 1) % 16)) % 16;
  const header = Buffer.from(`${dictionary}${" ".repeat(padding)}\n`, "ascii");
  const preamble = Buffer.alloc(10);
  preamble.set(Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]));
  preamble.writeUInt16LE(header.length, 8);
  const data = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => data.writeFloatLE(value, index * 4));
  return Buffer.concat([preamble, header, data]);
}

function manifest(representation: "z_depth" | "relative_z"): Buffer {
  return Buffer.from(
    JSON.stringify({
      schema_version: 1,
      display_name:
        representation === "z_depth"
          ? "M2 Metric Fixture"
          : "M2 Relative Fixture",
      representation,
      unit: representation === "z_depth" ? "m" : "unitless",
      camera: {
        model: "pinhole",
        width: 2,
        height: 2,
        fx: 2,
        fy: 2,
        cx: 0.5,
        cy: 0.5,
        distortion_model: "none",
      },
      alignment: { state: "registered_to_rgb" },
    }),
  );
}

async function importScene(
  page: Page,
  representation: "z_depth" | "relative_z",
): Promise<void> {
  await page.goto("/?token=e2e-token");
  await page.waitForLoadState("networkidle");
  await page.setInputFiles('input[aria-label="可选 manifest 文件"]', {
    name: "scene.json",
    mimeType: "application/json",
    buffer: manifest(representation),
  });
  await page.setInputFiles('input[aria-label="RGB 图像文件"]', {
    name: "rgb.png",
    mimeType: "image/png",
    buffer: rgbPng,
  });
  await page.setInputFiles('input[aria-label="深度数据文件"]', {
    name: "depth.npy",
    mimeType: "application/octet-stream",
    buffer: npyFloat32([1, 1, 1, 1], [2, 2]),
  });
  await expect(page.getByText("输入状态")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存 Scene" })).toBeEnabled();
  await page.getByRole("button", { name: "保存 Scene" }).click();
  const heading =
    representation === "z_depth" ? "M2 Metric Fixture" : "M2 Relative Fixture";
  await expect(
    page.getByRole("heading", { name: heading, exact: true }),
  ).toBeVisible();
}

async function applyAndSelectTwoPoints(page: Page): Promise<void> {
  await page.getByRole("button", { name: "应用处理" }).click();
  await expect(page.getByText("点云视图", { exact: true })).toBeVisible();
  const canvas = page.getByTestId("pointcloud-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("point-cloud canvas has no bounds");
  const cameraDistance = Math.hypot(0.5, 0.5) * 1.5;
  const verticalHalfExtent = cameraDistance * Math.tan(Math.PI / 8);
  const xOffset =
    0.25 / (2 * verticalHalfExtent * (bounds.width / bounds.height));
  const yOffset = 0.25 / (2 * verticalHalfExtent);
  await page.mouse.click(
    bounds.x + bounds.width * (0.5 - xOffset),
    bounds.y + bounds.height * (0.5 - yOffset),
  );
  await page.mouse.click(
    bounds.x + bounds.width * (0.5 + xOffset),
    bounds.y + bounds.height * (0.5 - yOffset),
  );
  await expect(page.getByTestId("measurement-distance")).toBeVisible();
}

test("applies a metric derivation, measures points, and exports static artifacts", async ({
  page,
}) => {
  await importScene(page, "z_depth");
  await expect(page.getByText("米制几何可用")).toBeVisible();
  await applyAndSelectTwoPoints(page);
  await expect(page.getByTestId("measurement-distance")).toContainText("m");

  const plyPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载 PLY" }).click();
  const plyPath = await (await plyPromise).path();
  expect((await readFile(plyPath!)).subarray(0, 4).toString("ascii")).toBe(
    "ply\n",
  );

  const jsonPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "下载参数 JSON" }).click();
  const jsonPath = await (await jsonPromise).path();
  const parameters = JSON.parse(await readFile(jsonPath!, "utf8"));
  expect(parameters.unit).toBe("m");
  expect(parameters.representation).toBe("z_depth");
  expect(parameters.processing.schema_version).toBe(1);
  expect(parameters.scene_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(parameters)).not.toContain("/private/");

  const pngPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 PNG" }).click();
  const pngPath = await (await pngPromise).path();
  expect((await readFile(pngPath!)).subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
});

test("keeps relative geometry unitless and responsive", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await importScene(page, "relative_z");
  await expect(page.getByText("相对几何可用")).toBeVisible();
  await applyAndSelectTwoPoints(page);
  await expect(page.getByTestId("measurement-distance")).toContainText(
    "unitless",
  );
  await expect(page.getByRole("button", { name: /复制米制距离/ })).toHaveCount(
    0,
  );
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("previews a camera trajectory from the applied derivation", async ({
  page,
}) => {
  await importScene(page, "z_depth");
  await page.getByRole("button", { name: "应用处理" }).click();
  await expect(page.getByText("点云视图", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /轨迹与导出/ }).click();
  await expect(page.getByRole("heading", { name: "轨迹预览" })).toBeVisible();
  await expect(page.getByLabel("轨迹预设")).toHaveValue("orbit");
  await page.getByLabel("轨迹预设").selectOption("spiral");
  await expect(page.getByText("150 帧", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "播放轨迹" }).click();
  await expect(page.getByRole("button", { name: "暂停轨迹" })).toBeVisible();
  await page.getByRole("button", { name: "重置轨迹" }).click();
  await expect(page.getByRole("button", { name: "播放轨迹" })).toBeVisible();
});
