import { z } from "zod";
import { formatSchema } from "./common";

export const capabilitySchema = z.enum([
  "image_inspection",
  "relative_pointcloud",
  "metric_pointcloud",
  "trajectory",
  "video_export",
]);
export const diagnosticSchema = z.object({
  ...formatSchema("diagnostic", 2),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  severity: z.enum(["info", "warning", "fatal"]),
  field: z.string().nullable().default(null),
  capability: capabilitySchema.nullable().default(null),
  messageKey: z.string().min(1),
  params: z.record(z.string(), z.json()).default({}),
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type Capability = z.infer<typeof capabilitySchema>;

export function diagnostic(
  code: string,
  severity: Diagnostic["severity"],
  messageKey: string,
  options: Partial<Pick<Diagnostic, "field" | "capability" | "params">> = {},
): Diagnostic {
  return diagnosticSchema.parse({
    format: "rgbd-workbench/diagnostic",
    schemaVersion: 2,
    code,
    severity,
    messageKey,
    field: options.field ?? null,
    capability: options.capability ?? null,
    params: options.params ?? {},
  });
}

const messages: Record<string, string> = {
  "source.required": "请选择 RGB 和深度文件。",
  "source.decodeFailed": "无法解码输入，请检查格式、尺寸与数据类型。",
  "source.unsupported": "此格式尚未支持，请使用已注册的输入格式。",
  "source.oversized": "输入超过当前浏览器资源预算，请减小尺寸或文件大小。",
  "source.missing": "原始数据不可用，请重新导入。",
  "source.integrity": "原始数据校验失败，请重新导入，旧派生结果不会被复用。",
  "depth.semanticsRequired": "请明确深度表示与单位；系统不会从数值范围猜测。",
  "geometry.invalid": "几何合同不完整，请检查尺寸、内参、对齐与校正状态。",
  "geometry.unsupported": "当前几何语义不支持点云处理。",
  "pointcloud.empty": "当前参数没有产生有效点，请放宽 ROI 或范围。",
  "pointcloud.budget": "处理超过资源预算，请降低点数或 KNN 邻域大小。",
  "processing.invalid": "处理参数不合法，请检查输入范围。",
  "runtime.unsupported": "当前浏览器缺少所需能力，请使用支持 WebGL2 与 WebCodecs 的现代浏览器。",
  "runtime.failure": "计算运行时失败，请重试；若持续失败请重新加载页面。",
  "storage.quota": "浏览器存储空间不足，请清理缓存或导出后删除 Scene。",
  "storage.failure": "本地工作区写入失败，当前更改未提交。",
  "trajectory.invalid": "轨迹无效，请检查时长、关键帧、target 与 up 向量。",
  "export.unsupported": "当前浏览器不支持所选编码格式，请切换格式或导出 PNG 序列。",
  "export.failed": "导出失败，未发布不完整文件。",
  "archive.invalid": "Archive 无效或不完整，请检查版本、文件与内容摘要。",
};

export function diagnosticText(item: Diagnostic): string {
  return messages[item.messageKey] ?? "发生未预期的问题，请检查输入后重试。";
}

export class WorkbenchError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(item: Diagnostic, options?: ErrorOptions) {
    super(diagnosticText(item), options);
    this.name = "WorkbenchError";
    this.diagnostics = [item];
  }
}

export function asWorkbenchError(
  cause: unknown,
  fallback = diagnostic("INTERNAL_ERROR", "fatal", "runtime.failure"),
): WorkbenchError {
  if (cause instanceof WorkbenchError) return cause;
  if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
  return new WorkbenchError(fallback, { cause });
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
}
