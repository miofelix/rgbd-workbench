import { test, expect } from "@playwright/test";

test("M1 shell opens with explicit disabled capabilities", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("RGB-D Lab", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /四视图对照/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /轨迹与导出/ })).toBeVisible();
  await page.screenshot({
    path: "test-results/m1-desktop.png",
    fullPage: true,
  });
});

test("M1 shell remains usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /检查与测量/ })).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
  await page.screenshot({ path: "test-results/m1-mobile.png", fullPage: true });
});

test("M1 imports a unitless RGB-D pair and commits a Scene", async ({
  page,
}) => {
  await page.goto("/?token=e2e-token");
  const rgbPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGMU0bBhYGBgYgADAAWiAHylyrQdAAAAAElFTkSuQmCC",
    "base64",
  );
  const pfm = Buffer.from(
    "Pf\n2 2\n1.0\n\x00\x00\x00?\x00\x00\x00?\x00\x00\x80?\x00\x00\x80?",
    "binary",
  );
  await page.setInputFiles('input[aria-label="RGB 图像文件"]', {
    name: "rgb.png",
    mimeType: "image/png",
    buffer: rgbPng,
  });
  await page.setInputFiles('input[aria-label="深度数据文件"]', {
    name: "relative.pfm",
    mimeType: "application/octet-stream",
    buffer: pfm,
  });
  await expect(
    page.getByLabel("导入诊断").getByText("DEPTH_SEMANTICS_REQUIRED"),
  ).toBeVisible();
  await page.getByLabel("深度表示").selectOption("relative_z");
  await page.getByLabel("单位").selectOption("unitless");
  await page.getByRole("button", { name: "确认参数" }).click();
  await expect(page.getByText("相对点云")).toBeVisible();
  await page.getByRole("button", { name: "保存 Scene" }).click();
  await expect(
    page.getByRole("heading", { name: "Untitled Scene", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /四视图对照/ }).click();
  await expect(page.getByText("四视图对照", { exact: true })).toBeVisible();
});
