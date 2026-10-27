import { FORMAT_LIMITS, SUPPORTED_RGB_EXTENSIONS } from "@/domain/codec-registry";
import { hashBlob } from "@/domain/identity";
import { diagnostic } from "@/domain/diagnostics";
import type { GeometryContract, ScenePreparation } from "@/domain/scene";
import { rawDescriptorSchema, geometryContractSchema } from "@/domain/scene";
import { blobText } from "@/shared/bytes";
import { decodeRgb } from "./codecs/image";
import { decodeDepth, fileExtension } from "./codecs";
import { depthPreview } from "./render/color-map";
import type { SourceSelection, ScenePreparationResult } from "@/application/contracts";
import type { RawDescriptor } from "./codecs/types";
import type { NumericDataType } from "@/domain/codec-registry";
import { parse as parseYaml } from "yaml";

function defaultGeometry(width: number, height: number): GeometryContract {
  return {
    depth: {
      representation: "relative_z",
      unit: "unitless",
      scaleToMeter: null,
      invalidValues: [],
      validMin: null,
      validMax: null,
    },
    camera: {
      model: "pinhole",
      width,
      height,
      fx: Math.max(width, height),
      fy: Math.max(width, height),
      cx: (width - 1) / 2,
      cy: (height - 1) / 2,
      distortionModel: "none",
    },
    alignment: { state: "registered_to_rgb", method: "user_confirmed" },
    rawDescriptor: null,
  };
}
function manifestMetadata(
  text: string,
  name: string,
): {
  name?: string;
  geometry?: Partial<GeometryContract>;
  rawDescriptor?: RawDescriptor;
} {
  const doc: unknown =
    fileExtension(name) === "json" ? JSON.parse(text) : parseYaml(text, { maxAliasCount: 32 });
  if (typeof doc !== "object" || doc === null || Array.isArray(doc))
    throw new Error("manifest root must be an object");
  const value = doc as Record<string, unknown>;
  const depth = (
    typeof value.depth === "object" && value.depth !== null ? value.depth : value
  ) as Record<string, unknown>;
  const camera = value.camera as Record<string, unknown> | undefined;
  const align =
    typeof value.alignment === "string"
      ? { state: value.alignment }
      : (value.alignment as Record<string, unknown> | undefined);
  const representation = depth.representation ?? depth.type ?? value.representation;
  const unit = depth.unit ?? value.unit;
  const raw = (depth.raw_descriptor ??
    depth.rawDescriptor ??
    (depth.shape && depth.dtype ? depth : null)) as Record<string, unknown> | undefined;
  const dtypeMap: Record<string, NumericDataType> = {
    float32: "float32",
    float64: "float64",
    uint8: "uint8",
    uint16: "uint16",
    uint32: "uint32",
    int16: "int16",
    int32: "int32",
    "<f4": "float32",
    "<f8": "float64",
    "<u2": "uint16",
  };
  const rawDescriptor = raw
    ? {
        shape: raw.shape as [number, number],
        dataType:
          dtypeMap[String(raw.dataType ?? raw.dtype)] ??
          (() => {
            throw new Error("RAW dtype is unsupported");
          })(),
        endianness: raw.endianness === "big" ? ("big" as const) : ("little" as const),
      }
    : undefined;
  return {
    ...(typeof value.display_name === "string"
      ? { name: value.display_name }
      : typeof value.name === "string"
        ? { name: value.name }
        : {}),
    geometry: {
      ...(representation === "z_depth" || representation === "relative_z"
        ? {
            depth: {
              representation,
              unit:
                unit === "m" || unit === "mm" || unit === "unitless"
                  ? unit
                  : representation === "relative_z"
                    ? "unitless"
                    : "m",
              scaleToMeter:
                typeof (depth.scaleToMeter ?? depth.scale_to_meter) === "number"
                  ? ((depth.scaleToMeter ?? depth.scale_to_meter) as number)
                  : null,
              invalidValues: Array.isArray(depth.invalidValues ?? depth.invalid_values)
                ? ((depth.invalidValues ?? depth.invalid_values) as number[])
                : [],
              validMin:
                typeof (depth.validMin ?? depth.valid_min) === "number"
                  ? ((depth.validMin ?? depth.valid_min) as number)
                  : null,
              validMax:
                typeof (depth.validMax ?? depth.valid_max) === "number"
                  ? ((depth.validMax ?? depth.valid_max) as number)
                  : null,
            },
          }
        : {}),
      ...(camera
        ? {
            camera: {
              model: "pinhole" as const,
              width: Number(camera.width),
              height: Number(camera.height),
              fx: Number(camera.fx),
              fy: Number(camera.fy),
              cx: Number(camera.cx),
              cy: Number(camera.cy),
              distortionModel: "none" as const,
            },
          }
        : {}),
      ...(align
        ? {
            alignment: {
              state:
                align.state === "registered_to_rgb"
                  ? ("registered_to_rgb" as const)
                  : align.state === "unregistered"
                    ? ("unregistered" as const)
                    : ("unknown" as const),
              method: typeof align.method === "string" ? align.method : null,
            },
          }
        : {}),
      ...(rawDescriptor ? { rawDescriptor } : {}),
    },
    ...(rawDescriptor ? { rawDescriptor } : {}),
  };
}
export async function prepareScene(input: SourceSelection): Promise<ScenePreparationResult> {
  if (input.rgb.size > FORMAT_LIMITS.maxFileBytes || input.depth.size > FORMAT_LIMITS.maxFileBytes)
    throw new RangeError("source exceeds browser budget");
  if (input.manifest && input.manifest.size > FORMAT_LIMITS.maxManifestBytes)
    throw new RangeError("manifest exceeds browser budget");
  const declared = input.manifest
    ? manifestMetadata(await blobText(input.manifest), input.manifest.name)
    : {};
  const rawDescriptor = declared.rawDescriptor
    ? rawDescriptorSchema.parse(declared.rawDescriptor)
    : undefined;
  const [rgb, depth, rgbHash, depthHash] = await Promise.all([
    decodeRgb(input.rgb),
    decodeDepth(input.depth, rawDescriptor),
    hashBlob(input.rgb),
    hashBlob(input.depth),
  ]);
  const geometry = geometryContractSchema.parse({
    ...defaultGeometry(depth.width, depth.height),
    ...declared.geometry,
  });
  const sourceBase = {
    format: "rgbd-workbench/source" as const,
    schemaVersion: 2 as const,
    mediaType: null,
    byteLength: 0,
    sha256: "",
    dataType: null,
  };
  const preparation: ScenePreparation = {
    sources: {
      rgb: {
        ...sourceBase,
        role: "rgb",
        name: input.rgb.name,
        byteLength: input.rgb.size,
        sha256: rgbHash,
        width: rgb.width,
        height: rgb.height,
        encoding: fileExtension(input.rgb.name),
      },
      depth: {
        ...sourceBase,
        role: "depth",
        name: input.depth.name,
        byteLength: input.depth.size,
        sha256: depthHash,
        width: depth.width,
        height: depth.height,
        dataType: depth.dataType,
        encoding: fileExtension(input.depth.name),
      },
    },
    diagnostics: [
      diagnostic("DEPTH_SEMANTICS_REQUIRED", "warning", "depth.semanticsRequired", {
        capability: "metric_pointcloud",
      }),
    ],
    suggestedGeometry: geometry,
  };
  if (!SUPPORTED_RGB_EXTENSIONS.has(fileExtension(input.rgb.name)))
    preparation.diagnostics.push(
      diagnostic("RGB_FORMAT_UNVERIFIED", "warning", "source.unsupported", {
        field: "sources.rgb",
      }),
    );
  if (declared.geometry?.depth)
    preparation.diagnostics = preparation.diagnostics.filter(
      (d) => d.code !== "DEPTH_SEMANTICS_REQUIRED",
    );
  return {
    ...preparation,
    ...(declared.name ? { suggestedName: declared.name } : {}),
    rgb,
    depth,
    depthPreview: depthPreview(depth.data, depth.width, depth.height),
    ...(rawDescriptor ? { rawDescriptor } : {}),
  };
}
