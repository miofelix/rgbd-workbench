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
  await page.getByRole("button", { name: "导入", exact: true }).click();
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

  await page.getByRole("button", { name: /轨迹预览/ }).click();
  await expect(page.getByRole("heading", { name: "轨迹预览" })).toBeVisible();
  await expect(page.getByLabel("轨迹预设")).toHaveValue("orbit");
  await page.getByLabel("轨迹预设").selectOption("spiral");
  await expect(page.getByText("150 帧", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "播放轨迹" }).click();
  await expect(page.getByRole("button", { name: "暂停轨迹" })).toBeVisible();
  await page.getByRole("button", { name: "重置轨迹" }).click();
  await expect(page.getByRole("button", { name: "播放轨迹" })).toBeVisible();
});

test("reopens an inspection-only scene and completes geometry as a new scene", async ({
  page,
}) => {
  await page.goto("/?token=e2e-token");
  await page.getByRole("button", { name: "导入", exact: true }).click();
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
  await page.getByLabel("深度表示").selectOption("z_depth");
  await page.getByLabel("单位").selectOption("m");
  await page.getByLabel("Scene 显示名称").fill("Inspection only");
  await page.getByRole("button", { name: "确认参数" }).click();
  await page.getByRole("button", { name: "保存 Scene" }).click();
  await expect(
    page.getByRole("heading", { name: "Inspection only" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "应用处理" })).toBeDisabled();
  const originalId = await page.getByLabel("当前场景").inputValue();

  await page.getByRole("button", { name: "编辑场景参数" }).click();
  await expect(page.getByText(/保存后创建新场景/)).toBeVisible();
  await expect(page.getByLabel("单位")).toHaveValue("m");
  await page.getByLabel("Scene 显示名称").fill("Completed geometry");
  await page.getByLabel("对齐状态").selectOption("registered_to_rgb");
  for (const [field, value] of Object.entries({
    width: 2,
    height: 2,
    fx: 2,
    fy: 2,
    cx: 0.5,
    cy: 0.5,
  })) {
    await page.getByLabel(`相机 ${field}`, { exact: true }).fill(String(value));
  }
  await page.getByLabel("相机畸变模型").selectOption("none");
  await page.getByRole("button", { name: "确认参数" }).click();
  await page.getByRole("button", { name: "保存 Scene" }).click();
  await expect(
    page.getByRole("heading", { name: "Completed geometry" }),
  ).toBeVisible();
  await expect(page.getByText("米制几何可用")).toBeVisible();
  const completedId = await page.getByLabel("当前场景").inputValue();
  expect(completedId).not.toBe(originalId);
  await applyAndSelectTwoPoints(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("当前场景").selectOption(originalId);
  await expect(page.getByRole("button", { name: "应用处理" })).toBeDisabled();
  await page.getByLabel("当前场景").selectOption(completedId);
  await expect(
    page.getByRole("heading", { name: "Completed geometry" }),
  ).toBeVisible();
});

test("recovers a failed point-cloud download and preserves analysis through navigation", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/pointcloud", async (route) => {
    if (fail) {
      fail = false;
      await route.abort("failed");
    } else await route.continue();
  });
  await importScene(page, "z_depth");
  await page.getByRole("button", { name: "应用处理" }).click();
  await expect(page.getByRole("alert")).toContainText("无法加载点云");
  await expect(page.getByRole("button", { name: "下载 PNG" })).toBeDisabled();
  await page.getByRole("button", { name: "重新加载点云" }).click();
  await expect(page.getByRole("button", { name: "下载 PNG" })).toBeEnabled();
  await page.locator(".scene-row[aria-current='true']").click();
  await expect(page.getByRole("button", { name: "下载 PNG" })).toBeEnabled();
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "导出", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /检查与测量/ }).click();
  await expect(page.getByRole("button", { name: "下载 PNG" })).toBeEnabled();
  await page.getByRole("button", { name: /轨迹预览/ }).click();
  await expect(page.getByRole("button", { name: "播放轨迹" })).toBeEnabled();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await expect(page.getByRole("link", { name: "下载 PLY" })).toBeFocused();
  await expect(page.getByRole("button", { name: "正交投影" })).toBeDisabled();
  await page.getByLabel("轨迹时长").fill("3600");
  await expect(page.getByRole("alert")).toContainText("最多支持 6,000 帧");
  await expect(page.getByRole("button", { name: "播放轨迹" })).toBeDisabled();
  await page.getByLabel("轨迹时长").fill("5");
  await expect(page.getByRole("button", { name: "播放轨迹" })).toBeEnabled();
});

test("keeps all analysis modes usable from small phones to desktop", async ({
  page,
}) => {
  await importScene(page, "relative_z");
  await page.getByRole("button", { name: "应用处理" }).click();
  await expect(page.getByRole("button", { name: "下载 PNG" })).toBeEnabled();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ["检查与测量", "四视图对照", "轨迹预览"]) {
      await page.getByRole("button", { name: new RegExp(mode) }).click();
      await expect(
        page.getByRole("button", { name: "下载 PNG" }),
      ).toBeEnabled();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        ),
      ).toBe(false);
      if (width === 390 || width === 1440) {
        await page.screenshot({
          path: `test-results/design-${width}-${mode}.png`,
          fullPage: true,
        });
      }
    }
  }
});
