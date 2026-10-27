import type { Vector3 } from "@/domain/common";
export type ColorMode = "rgb" | "depth" | "mono" | "validity";
export type ColorMap = "turbo" | "viridis" | "inferno" | "magma" | "plasma" | "cividis" | "gray";
export interface ViewSpec {
  projection: "perspective" | "orthographic";
  colorMode: ColorMode;
  colorMap: ColorMap;
  pointSize: number;
  background: "dark" | "light";
}
export interface SelectedPoint {
  pixelIndex: number;
  position: Vector3;
  unit: "m" | "unitless";
}
export const DEFAULT_VIEW: ViewSpec = {
  projection: "perspective",
  colorMode: "rgb",
  colorMap: "turbo",
  pointSize: 2,
  background: "dark",
};
