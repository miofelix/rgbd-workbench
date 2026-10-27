import type { Vector3 } from "@/domain/common";

export type ColorMapName =
  "turbo" | "viridis" | "inferno" | "magma" | "plasma" | "cividis" | "gray";
interface Stop {
  at: number;
  rgb: Vector3;
}
const STOPS: Record<Exclude<ColorMapName, "gray">, Stop[]> = {
  turbo: [
    { at: 0, rgb: [48, 18, 59] },
    { at: 0.25, rgb: [50, 127, 190] },
    { at: 0.5, rgb: [42, 190, 137] },
    { at: 0.75, rgb: [217, 219, 51] },
    { at: 1, rgb: [122, 4, 3] },
  ],
  viridis: [
    { at: 0, rgb: [68, 1, 84] },
    { at: 0.25, rgb: [59, 82, 139] },
    { at: 0.5, rgb: [33, 145, 140] },
    { at: 0.75, rgb: [94, 201, 98] },
    { at: 1, rgb: [253, 231, 37] },
  ],
  inferno: [
    { at: 0, rgb: [0, 0, 4] },
    { at: 0.25, rgb: [87, 16, 110] },
    { at: 0.5, rgb: [188, 55, 84] },
    { at: 0.75, rgb: [249, 142, 9] },
    { at: 1, rgb: [252, 255, 164] },
  ],
  magma: [
    { at: 0, rgb: [0, 0, 4] },
    { at: 0.25, rgb: [81, 18, 124] },
    { at: 0.5, rgb: [183, 55, 121] },
    { at: 0.75, rgb: [252, 137, 97] },
    { at: 1, rgb: [252, 253, 191] },
  ],
  plasma: [
    { at: 0, rgb: [13, 8, 135] },
    { at: 0.25, rgb: [126, 3, 168] },
    { at: 0.5, rgb: [204, 71, 120] },
    { at: 0.75, rgb: [248, 149, 64] },
    { at: 1, rgb: [240, 249, 33] },
  ],
  cividis: [
    { at: 0, rgb: [0, 34, 78] },
    { at: 0.25, rgb: [61, 74, 107] },
    { at: 0.5, rgb: [123, 123, 114] },
    { at: 0.75, rgb: [190, 173, 104] },
    { at: 1, rgb: [255, 233, 69] },
  ],
};
function buildLut(name: Exclude<ColorMapName, "gray">): Uint8Array {
  const result = new Uint8Array(256 * 3);
  const stops = STOPS[name];
  for (let index = 0; index < 256; index += 1) {
    const t = index / 255;
    const rightIndex = stops.findIndex((stop) => stop.at >= t);
    const right = stops[Math.max(1, rightIndex < 0 ? stops.length - 1 : rightIndex)]!;
    const left = stops[Math.max(0, (rightIndex < 0 ? stops.length - 1 : rightIndex) - 1)]!;
    const mix = right.at === left.at ? 0 : (t - left.at) / (right.at - left.at);
    for (let channel = 0; channel < 3; channel += 1)
      result[index * 3 + channel] = Math.round(
        left.rgb[channel]! + (right.rgb[channel]! - left.rgb[channel]!) * mix,
      );
  }
  return result;
}
export const COLOR_MAPS: Record<ColorMapName, { version: "1"; values: Uint8Array }> = {
  ...(Object.fromEntries(
    Object.keys(STOPS).map((name) => [
      name,
      { version: "1", values: buildLut(name as Exclude<ColorMapName, "gray">) },
    ]),
  ) as Record<Exclude<ColorMapName, "gray">, { version: "1"; values: Uint8Array }>),
  gray: { version: "1", values: Uint8Array.from({ length: 256 * 3 }, (_, i) => Math.floor(i / 3)) },
};
export function sampleColorMap(name: ColorMapName, value: number): [number, number, number] {
  const index = Math.round(Math.min(1, Math.max(0, value)) * 255);
  const values = COLOR_MAPS[name].values;
  return [values[index * 3]!, values[index * 3 + 1]!, values[index * 3 + 2]!];
}
export function turbo(value: number): [number, number, number] {
  return sampleColorMap("turbo", value);
}
export function depthPreview(
  values: ArrayLike<number>,
  width: number,
  height: number,
  invalidMask?: Uint8Array,
): Uint8Array {
  const valid = Array.from(values)
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  const low = valid[Math.floor((valid.length - 1) * 0.02)] ?? 0;
  const high = valid[Math.floor((valid.length - 1) * 0.98)] ?? 1;
  const result = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const value = values[i]!;
    const color =
      (invalidMask && !invalidMask[i]) || !Number.isFinite(value) || value <= 0
        ? ([0, 0, 0] as const)
        : turbo((value - low) / Math.max(1e-12, high - low));
    result[i * 3] = color[0];
    result[i * 3 + 1] = color[1];
    result[i * 3 + 2] = color[2];
  }
  return result;
}
