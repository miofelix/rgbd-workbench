import { LoaderCircle, Play, SlidersHorizontal } from "lucide-react";
import { useId } from "react";

import type { ProcessingSpec } from "../../api/types";
import { DEFAULT_PROCESSING, useWorkbenchStore } from "../../state/workbench";
import { validateProcessing } from "./processing-validation";

interface ProcessingPanelProps {
  enabled: boolean;
  sourceWidth: number;
  sourceHeight: number;
  unit?: "m" | "unitless";
  blockedReason?: string;
}

type NullableNumberField = "depth_min" | "depth_max" | "voxel_size";

function nullableNumber(value: string): number | null {
  return value === "" ? null : Number(value);
}

function requiredNumber(value: string): number {
  return value === "" ? Number.NaN : Number(value);
}

function inputValue(value: number | null): number | "" {
  return value !== null && Number.isFinite(value) ? value : "";
}

export function ProcessingPanel({
  enabled,
  sourceWidth,
  sourceHeight,
  unit = "unitless",
  blockedReason = "补全单位、内参和对齐后解锁。",
}: ProcessingPanelProps): React.JSX.Element {
  const {
    draftProcessing,
    appliedProcessing,
    derivationBusy,
    derivationCached,
    diagnostics,
    setDraftProcessing,
    applyProcessing,
  } = useWorkbenchStore();
  const errorPrefix = useId();
  const validation = validateProcessing(
    draftProcessing,
    sourceWidth,
    sourceHeight,
  );
  const firstGeneration = appliedProcessing === null;
  const dirty =
    !firstGeneration &&
    (validation.length > 0 ||
      JSON.stringify(draftProcessing) !== JSON.stringify(appliedProcessing));
  const isDefault =
    validation.length === 0 &&
    JSON.stringify(draftProcessing) === JSON.stringify(DEFAULT_PROCESSING);
  const locked = !enabled || derivationBusy;
  const validationAttrs = (field: string) => {
    const describedBy = validation
      .map((issue, index) =>
        issue.field === field ? `${errorPrefix}-${index}` : null,
      )
      .filter(Boolean)
      .join(" ");
    return {
      "aria-invalid": describedBy !== "",
      "aria-describedby": describedBy || undefined,
    };
  };
  const advancedCount = [
    draftProcessing.voxel_size !== null,
    draftProcessing.roi !== null,
    draftProcessing.xyz_min !== null || draftProcessing.xyz_max !== null,
    draftProcessing.knn_filter !== null,
    draftProcessing.knn_smooth !== null,
  ].filter(Boolean).length;
  const patch = (next: Partial<ProcessingSpec>): void => {
    setDraftProcessing({ ...draftProcessing, ...next });
  };
  const patchNumber = (field: NullableNumberField, value: string): void => {
    patch({ [field]: nullableNumber(value) });
  };
  const patchTuple = (
    field: "roi" | "xyz_min" | "xyz_max",
    index: number,
    value: string,
  ): void => {
    const current = draftProcessing[field];
    if (current === null) return;
    const next = [...current] as
      [number, number, number, number] | [number, number, number];
    next[index] = requiredNumber(value);
    patch({ [field]: next } as Partial<ProcessingSpec>);
  };

  return (
    <section
      className="panel processing-panel"
      aria-labelledby="processing-title"
    >
      <div className="panel-heading">
        <div>
          <h3 id="processing-title">点云处理</h3>
        </div>
        <div className="processing-state">
          {derivationBusy ? (
            <span>正在生成点云</span>
          ) : firstGeneration ? (
            <span>待生成点云</span>
          ) : dirty ? (
            <span className="dirty-indicator">有未应用更改</span>
          ) : (
            <span>已应用</span>
          )}
          {derivationCached && !dirty && (
            <span className="cache-indicator">缓存命中</span>
          )}
          <SlidersHorizontal size={17} />
        </div>
      </div>

      <fieldset
        className="processing-form"
        aria-label="点云处理参数"
        disabled={locked}
      >
        <div className="processing-fields">
          <label>
            像素步长
            <input
              aria-label="像素步长"
              type="number"
              min="1"
              step="1"
              value={inputValue(draftProcessing.pixel_stride)}
              {...validationAttrs("pixel_stride")}
              onChange={(event) =>
                patch({ pixel_stride: requiredNumber(event.target.value) })
              }
            />
          </label>
          <label>
            最大点数
            <input
              aria-label="最大点数"
              type="number"
              min="100"
              max="2000000"
              step="1"
              value={inputValue(draftProcessing.max_points)}
              {...validationAttrs("max_points")}
              onChange={(event) =>
                patch({ max_points: requiredNumber(event.target.value) })
              }
            />
          </label>
          <label>
            深度下限 ({unit})
            <input
              aria-label="深度下限"
              type="number"
              min="0"
              step="any"
              value={inputValue(draftProcessing.depth_min)}
              {...validationAttrs("depth_min")}
              placeholder="不限制"
              onChange={(event) => patchNumber("depth_min", event.target.value)}
            />
          </label>
          <label>
            深度上限 ({unit})
            <input
              aria-label="深度上限"
              type="number"
              min="0"
              step="any"
              value={inputValue(draftProcessing.depth_max)}
              {...validationAttrs("depth_max")}
              placeholder="不限制"
              onChange={(event) => patchNumber("depth_max", event.target.value)}
            />
          </label>
        </div>

        <details className="advanced-processing">
          <summary>
            高级处理
            {advancedCount > 0 && <span> · {advancedCount} 项启用</span>}
          </summary>
          <p className="processing-hint">
            按需开启裁剪、降采样和邻域操作。空间参数单位：{unit}。
          </p>
          <div className="processing-fields advanced-fields">
            <label>
              体素尺寸 ({unit})
              <input
                aria-label="体素尺寸"
                type="number"
                min="0"
                step="any"
                value={inputValue(draftProcessing.voxel_size)}
                {...validationAttrs("voxel_size")}
                placeholder="关闭"
                onChange={(event) =>
                  patchNumber("voxel_size", event.target.value)
                }
              />
            </label>
          </div>

          <div className="processing-options">
            <fieldset>
              <legend>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={draftProcessing.roi !== null}
                    onChange={(event) =>
                      patch({
                        roi: event.target.checked
                          ? [0, 0, sourceWidth, sourceHeight]
                          : null,
                      })
                    }
                  />
                  像素 ROI
                </label>
              </legend>
              {draftProcessing.roi && (
                <div className="tuple-fields four">
                  {(
                    ["左边界 X", "上边界 Y", "右边界 X", "下边界 Y"] as const
                  ).map((label, index) => (
                    <label key={label}>
                      {label}
                      <input
                        type="number"
                        min="0"
                        max={index % 2 === 0 ? sourceWidth : sourceHeight}
                        step="1"
                        value={inputValue(draftProcessing.roi?.[index] ?? null)}
                        {...validationAttrs(`roi.${index}`)}
                        onChange={(event) =>
                          patchTuple("roi", index, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <fieldset>
              <legend>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    aria-label="XYZ 范围"
                    checked={
                      draftProcessing.xyz_min !== null ||
                      draftProcessing.xyz_max !== null
                    }
                    onChange={(event) =>
                      patch({
                        xyz_min: event.target.checked ? [-1, -1, 0.001] : null,
                        xyz_max: event.target.checked ? [1, 1, 10] : null,
                      })
                    }
                  />
                  XYZ 范围 ({unit})
                </label>
              </legend>
              {draftProcessing.xyz_min && draftProcessing.xyz_max && (
                <div className="tuple-fields six">
                  {[...draftProcessing.xyz_min, ...draftProcessing.xyz_max].map(
                    (value, index) => (
                      <label key={index}>
                        {"XYZ"[index % 3]} {index < 3 ? "下限" : "上限"}
                        <input
                          type="number"
                          step="any"
                          value={inputValue(value)}
                          {...validationAttrs(
                            `${index < 3 ? "xyz_min" : "xyz_max"}.${index % 3}`,
                          )}
                          onChange={(event) =>
                            patchTuple(
                              index < 3 ? "xyz_min" : "xyz_max",
                              index % 3,
                              event.target.value,
                            )
                          }
                        />
                      </label>
                    ),
                  )}
                </div>
              )}
            </fieldset>

            <fieldset>
              <legend>邻域操作</legend>
              <div className="knn-options">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={draftProcessing.knn_filter !== null}
                    onChange={(event) =>
                      patch({
                        knn_filter: event.target.checked
                          ? { k: 16, std_ratio: 2 }
                          : null,
                      })
                    }
                  />
                  离群过滤
                </label>
                {draftProcessing.knn_filter && (
                  <div className="knn-fields">
                    <label>
                      离群 K
                      <input
                        aria-label="离群 K"
                        type="number"
                        min="1"
                        max="64"
                        step="1"
                        value={inputValue(draftProcessing.knn_filter.k)}
                        {...validationAttrs("knn_filter.k")}
                        onChange={(event) =>
                          patch({
                            knn_filter: {
                              ...draftProcessing.knn_filter!,
                              k: requiredNumber(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      标准差比例
                      <input
                        aria-label="离群标准差比例"
                        type="number"
                        min="0"
                        max="5"
                        step="any"
                        value={inputValue(draftProcessing.knn_filter.std_ratio)}
                        {...validationAttrs("knn_filter.std_ratio")}
                        onChange={(event) =>
                          patch({
                            knn_filter: {
                              ...draftProcessing.knn_filter!,
                              std_ratio: requiredNumber(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                )}
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={draftProcessing.knn_smooth !== null}
                    onChange={(event) =>
                      patch({
                        knn_smooth: event.target.checked ? { k: 16 } : null,
                      })
                    }
                  />
                  KNN 平滑
                </label>
                {draftProcessing.knn_smooth && (
                  <div className="knn-fields one">
                    <label>
                      平滑 K
                      <input
                        aria-label="平滑 K"
                        type="number"
                        min="1"
                        max="64"
                        step="1"
                        value={inputValue(draftProcessing.knn_smooth.k)}
                        {...validationAttrs("knn_smooth.k")}
                        onChange={(event) =>
                          patch({
                            knn_smooth: {
                              k: requiredNumber(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                )}
              </div>
            </fieldset>
          </div>
        </details>
      </fieldset>

      {validation.length > 0 && (
        <div className="processing-validation" role="alert">
          <strong>请检查处理参数</strong>
          <ul>
            {validation.map((issue, index) => (
              <li
                id={`${errorPrefix}-${index}`}
                key={`${issue.field}-${index}`}
              >
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {diagnostics.length > 0 && (
        <div className="diagnostic-list processing-diagnostics">
          {diagnostics.map((item) => (
            <div className={`diagnostic ${item.severity}`} key={item.code}>
              <strong>{item.message}</strong>
              {item.hint && <span>{item.hint}</span>}
            </div>
          ))}
        </div>
      )}
      {!enabled && <p className="processing-blocked">{blockedReason}</p>}
      <div className="processing-actions">
        <button
          type="button"
          className="secondary"
          disabled={locked || !dirty}
          onClick={() => {
            if (appliedProcessing) setDraftProcessing({ ...appliedProcessing });
          }}
        >
          还原已应用
        </button>
        <button
          type="button"
          className="secondary"
          disabled={locked || isDefault}
          onClick={() => setDraftProcessing({ ...DEFAULT_PROCESSING })}
        >
          恢复默认
        </button>
        <button
          type="button"
          className="primary"
          disabled={
            locked || (!firstGeneration && !dirty) || validation.length > 0
          }
          onClick={() => {
            if (!locked && validation.length === 0) void applyProcessing();
          }}
        >
          {derivationBusy ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Play size={15} />
          )}
          {derivationBusy ? "正在生成" : "应用处理"}
        </button>
      </div>
    </section>
  );
}
