import type { ProcessingSpec } from "../../api/types";

export interface ProcessingValidationIssue {
  field: string;
  message: string;
}

export function validateProcessing(
  processing: ProcessingSpec,
  sourceWidth: number,
  sourceHeight: number,
): ProcessingValidationIssue[] {
  const issues: ProcessingValidationIssue[] = [];
  const issue = (field: string, message: string): void => {
    issues.push({ field, message });
  };
  const integer = (
    field: string,
    label: string,
    value: number,
    min: number,
    max?: number,
  ): void => {
    if (
      !Number.isSafeInteger(value) ||
      value < min ||
      (max !== undefined && value > max)
    ) {
      issue(
        field,
        max === undefined
          ? `${label}必须是大于或等于 ${min} 的整数。`
          : `${label}必须是 ${min}–${max.toLocaleString("zh-CN")} 之间的整数。`,
      );
    }
  };
  const positive = (
    field: string,
    label: string,
    value: number | null,
  ): void => {
    if (value !== null && (!Number.isFinite(value) || value <= 0)) {
      issue(field, `${label}必须是大于 0 的有限数值，留空可关闭限制。`);
    }
  };

  integer("pixel_stride", "像素步长", processing.pixel_stride, 1);
  integer("max_points", "最大点数", processing.max_points, 100, 2_000_000);
  positive("depth_min", "深度下限", processing.depth_min);
  positive("depth_max", "深度上限", processing.depth_max);
  positive("voxel_size", "体素尺寸", processing.voxel_size);
  if (
    processing.depth_min !== null &&
    processing.depth_max !== null &&
    processing.depth_min > processing.depth_max
  ) {
    issue("depth_max", "深度上限不能小于深度下限。");
  }

  if (processing.roi !== null) {
    const labels = ["ROI 左边界", "ROI 上边界", "ROI 右边界", "ROI 下边界"];
    processing.roi.forEach((value, index) => {
      const max = index % 2 === 0 ? sourceWidth : sourceHeight;
      integer(`roi.${index}`, labels[index], value, 0, max);
    });
    if (processing.roi[0] >= processing.roi[2]) {
      issue("roi.2", "ROI 右边界必须大于左边界。");
    }
    if (processing.roi[1] >= processing.roi[3]) {
      issue("roi.3", "ROI 下边界必须大于上边界。");
    }
  }

  (["xyz_min", "xyz_max"] as const).forEach((field) => {
    processing[field]?.forEach((value, index) => {
      if (!Number.isFinite(value)) {
        issue(
          `${field}.${index}`,
          `${"XYZ"[index]} 轴${field === "xyz_min" ? "下限" : "上限"}必须是有限数值。`,
        );
      }
    });
  });
  if (processing.xyz_min !== null && processing.xyz_max !== null) {
    processing.xyz_min.forEach((value, index) => {
      if (value > processing.xyz_max![index]) {
        issue(`xyz_max.${index}`, `${"XYZ"[index]} 轴上限不能小于下限。`);
      }
    });
  }

  if (processing.knn_filter !== null) {
    integer("knn_filter.k", "离群 K", processing.knn_filter.k, 1, 64);
    if (
      !Number.isFinite(processing.knn_filter.std_ratio) ||
      processing.knn_filter.std_ratio < 0 ||
      processing.knn_filter.std_ratio > 5
    ) {
      issue("knn_filter.std_ratio", "标准差比例必须是 0–5 之间的有限数值。");
    }
  }
  if (processing.knn_smooth !== null) {
    integer("knn_smooth.k", "平滑 K", processing.knn_smooth.k, 1, 64);
  }
  return issues;
}
