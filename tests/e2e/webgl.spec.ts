import { expect, test } from "@playwright/test";

test("browser exposes WebGL2 for point-cloud preview", async ({ page }) => {
  await page.goto("/");
  const capabilities = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    return gl
      ? { webgl2: true, renderer: gl.getParameter(gl.RENDERER), vendor: gl.getParameter(gl.VENDOR) }
      : { webgl2: false };
  });
  console.log("WEBGL_CAPABILITY", JSON.stringify(capabilities));
  expect(capabilities.webgl2).toBe(true);
});
