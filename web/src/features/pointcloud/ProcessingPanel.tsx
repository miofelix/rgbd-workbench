import { LoaderCircle, Play, SlidersHorizontal } from "lucide-react";

import type { ProcessingSpec } from "../../api/types";
import { useWorkbenchStore } from "../../state/workbench";

interface ProcessingPanelProps {
  enabled: boolean;
  sourceWidth: number;
  sourceHeight: number;
  blockedReason?: string;
}

type NullableNumberField = "depth_min" | "depth_max" | "voxel_size";

function nullableNumber(value: string): number | null {
  return value === "" ? null : Number(value);
}

export function ProcessingPanel({
  enabled,
  sourceWidth,
  sourceHeight,
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
  const dirty =
    appliedProcessing === null ||
    JSON.stringify(draftProcessing) !== JSON.stringify(appliedProcessing);
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
    next[index] = Number(value);
    patch({ [field]: next } as Partial<ProcessingSpec>);
  };

  return (
    <section
      className="panel processing-panel"
      aria-labelledby="processing-title"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">PROCESSING SPEC</span>
          <h3 id="processing-title">点云处理</h3>
        </div>
        <div className="processing-state">
          {dirty ? (
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

      <div className="processing-fields">
        <label>
          像素步长
          <input
            aria-label="像素步长"
            type="number"
            min="1"
            step="1"
            value={draftProcessing.pixel_stride}
            onChange={(event) =>
              patch({ pixel_stride: Math.max(1, Number(event.target.value)) })
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
            step="1000"
            value={draftProcessing.max_points}
            onChange={(event) =>
              patch({ max_points: Number(event.target.value) })
            }
          />
        </label>
        <label>
          深度下限
          <input
            aria-label="深度下限"
            type="number"
            min="0"
            step="any"
            value={draftProcessing.depth_min ?? ""}
            placeholder="不限制"
            onChange={(event) => patchNumber("depth_min", event.target.value)}
          />
        </label>
        <label>
          深度上限
          <input
            aria-label="深度上限"
            type="number"
            min="0"
            step="any"
            value={draftProcessing.depth_max ?? ""}
            placeholder="不限制"
            onChange={(event) => patchNumber("depth_max", event.target.value)}
          />
        </label>
        <label>
          体素尺寸
          <input
            aria-label="体素尺寸"
            type="number"
            min="0"
            step="any"
            value={draftProcessing.voxel_size ?? ""}
            placeholder="关闭"
            onChange={(event) => patchNumber("voxel_size", event.target.value)}
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
              {(["x min", "y min", "x max", "y max"] as const).map(
                (label, index) => (
                  <label key={label}>
                    {label}
                    <input
                      type="number"
                      value={draftProcessing.roi?.[index] ?? 0}
                      onChange={(event) =>
                        patchTuple("roi", index, event.target.value)
                      }
                    />
                  </label>
                ),
              )}
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>
            <label className="toggle-label">
              <input
                type="checkbox"
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
              XYZ 范围
            </label>
          </legend>
          {draftProcessing.xyz_min && draftProcessing.xyz_max && (
            <div className="tuple-fields six">
              {[...draftProcessing.xyz_min, ...draftProcessing.xyz_max].map(
                (value, index) => (
                  <label key={index}>
                    {index < 3 ? "min" : "max"} {"XYZ"[index % 3]}
                    <input
                      type="number"
                      step="any"
                      value={value}
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
                    value={draftProcessing.knn_filter.k}
                    onChange={(event) =>
                      patch({
                        knn_filter: {
                          ...draftProcessing.knn_filter!,
                          k: Number(event.target.value),
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
                    step="0.1"
                    value={draftProcessing.knn_filter.std_ratio}
                    onChange={(event) =>
                      patch({
                        knn_filter: {
                          ...draftProcessing.knn_filter!,
                          std_ratio: Number(event.target.value),
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
                  patch({ knn_smooth: event.target.checked ? { k: 16 } : null })
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
                    value={draftProcessing.knn_smooth.k}
                    onChange={(event) =>
                      patch({
                        knn_smooth: { k: Number(event.target.value) },
                      })
                    }
                  />
                </label>
              </div>
            )}
          </div>
        </fieldset>
      </div>

      {diagnostics.length > 0 && (
        <div className="diagnostic-list processing-diagnostics">
          {diagnostics.map((item) => (
            <div className={`diagnostic ${item.severity}`} key={item.code}>
              <strong>{item.code}</strong>
              <span>{item.message}</span>
            </div>
          ))}
        </div>
      )}
      {!enabled && <p className="processing-blocked">{blockedReason}</p>}
      <div className="processing-actions">
        <button
          type="button"
          className="primary"
          disabled={!enabled || derivationBusy || !dirty}
          onClick={() => void applyProcessing()}
        >
          {derivationBusy ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <Play size={15} />
          )}
          {derivationBusy ? "正在派生" : "应用处理"}
        </button>
      </div>
    </section>
  );
}
