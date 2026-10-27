export function rgbPng(rgb: { pixels: Uint8Array; width: number; height: number }): string {
  const canvas = document.createElement("canvas");
  canvas.width = rgb.width;
  canvas.height = rgb.height;
  const context = canvas.getContext("2d")!;
  const data = context.createImageData(rgb.width, rgb.height);
  for (let i = 0, j = 0; i < rgb.pixels.length; i += 3, j += 4) {
    data.data[j] = rgb.pixels[i]!;
    data.data[j + 1] = rgb.pixels[i + 1]!;
    data.data[j + 2] = rgb.pixels[i + 2]!;
    data.data[j + 3] = 255;
  }
  context.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}
export function depthPng(pixels: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const data = context.createImageData(width, height);
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    data.data[j] = pixels[i]!;
    data.data[j + 1] = pixels[i + 1]!;
    data.data[j + 2] = pixels[i + 2]!;
    data.data[j + 3] = 255;
  }
  context.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}
