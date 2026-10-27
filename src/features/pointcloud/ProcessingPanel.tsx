import { Play } from "lucide-react";
import type { Workbench } from "@/application/workbench";
import { useWorkbench } from "@/app/state";
import { capabilityReport } from "@/domain/capabilities";
import { processingSpecSchema } from "@/domain/processing";

export function ProcessingPanel({ workbench }: { workbench: Workbench }): React.JSX.Element | null {
  const { scene, draft, applied, busy, setDraft, derive } = useWorkbench();
  if (!scene) return null;
  const capabilities = capabilityReport(scene);
  const enabled = capabilities.metric_pointcloud || capabilities.relative_pointcloud;
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const patch = (value: Partial<typeof draft>): void => setDraft({ ...draft, ...value });
  const number = (value: string, fallback: number): number =>
    Number.isFinite(Number(value)) ? Number(value) : fallback;
  const vector = (field: "xyzMin" | "xyzMax", index: number, value: string): void => {
    const current = draft[field] ?? [0, 0, 0];
    const next = [...current] as [number, number, number];
    next[index] = Number(value);
    patch({ [field]: next });
  };
  return (
    <section className="panel processing-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">DETERMINISTIC PROCESSING</span>
          <h3>点云处理</h3>
        </div>
        <span className={dirty ? "dirty-chip" : "applied-chip"}>{dirty ? "DRAFT" : "APPLIED"}</span>
      </div>
      <div className="processing-grid">
        <label>
          像素步长
          <input
            aria-label="像素步长"
            type="number"
            min="1"
            max="1024"
            value={draft.pixelStride}
            onChange={(e) =>
              patch({ pixelStride: Math.max(1, Math.round(number(e.target.value, 1))) })
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
            step="100"
            value={draft.maxPoints}
            onChange={(e) =>
              patch({ maxPoints: Math.max(100, Math.round(number(e.target.value, 2000000))) })
            }
          />
        </label>
        <label>
          最小深度
          <input
            aria-label="最小深度"
            type="number"
            min="0"
            step="any"
            placeholder="未限制"
            value={draft.depthMin ?? ""}
            onChange={(e) => patch({ depthMin: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
        <label>
          最大深度
          <input
            aria-label="最大深度"
            type="number"
            min="0"
            step="any"
            placeholder="未限制"
            value={draft.depthMax ?? ""}
            onChange={(e) => patch({ depthMax: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
        <label>
          体素大小
          <input
            aria-label="体素大小"
            type="number"
            min="0"
            step="any"
            placeholder="关闭"
            value={draft.voxelSize ?? ""}
            onChange={(e) => patch({ voxelSize: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
        <label>
          KNN 平滑 K
          <input
            aria-label="KNN 平滑 K"
            type="number"
            min="1"
            max="64"
            placeholder="关闭"
            value={draft.knnSmooth?.k ?? ""}
            onChange={(e) =>
              patch({ knnSmooth: e.target.value ? { k: Number(e.target.value) } : null })
            }
          />
        </label>
      </div>
      <div className="processing-toggles">
        <label>
          <input
            aria-label="启用 ROI"
            type="checkbox"
            checked={draft.roi !== null}
            onChange={(e) =>
              patch({
                roi: e.target.checked
                  ? [0, 0, scene.sources.depth.width!, scene.sources.depth.height!]
                  : null,
              })
            }
          />
          启用 ROI
        </label>
        <label>
          <input
            aria-label="启用 XYZ 范围"
            type="checkbox"
            checked={draft.xyzMin !== null && draft.xyzMax !== null}
            onChange={(e) =>
              patch({
                xyzMin: e.target.checked ? [-1, -1, 0] : null,
                xyzMax: e.target.checked ? [1, 1, 100] : null,
              })
            }
          />
          XYZ 范围
        </label>
        <label>
          <input
            aria-label="KNN 离群过滤"
            type="checkbox"
            checked={draft.knnFilter !== null}
            onChange={(e) => patch({ knnFilter: e.target.checked ? { k: 16, stdRatio: 2 } : null })}
          />
          KNN 离群过滤
        </label>
      </div>
      {draft.roi && (
        <div className="form-grid four">
          {draft.roi.map((value, i) => (
            <label key={i}>
              {["x min", "y min", "x max", "y max"][i]}
              <input
                aria-label={`ROI ${i}`}
                type="number"
                value={value}
                onChange={(e) => {
                  const roi = [...draft.roi!] as [number, number, number, number];
                  roi[i] = Number(e.target.value);
                  patch({ roi });
                }}
              />
            </label>
          ))}
        </div>
      )}
      {draft.xyzMin && draft.xyzMax && (
        <div className="xyz-fields">
          {(["xyzMin", "xyzMax"] as const).map((field) => (
            <fieldset key={field}>
              <legend>{field === "xyzMin" ? "XYZ min" : "XYZ max"}</legend>
              <div className="form-grid three">
                {draft[field]!.map((value, i) => (
                  <label key={i}>
                    {"XYZ"[i]}
                    <input
                      aria-label={`${field} ${"xyz"[i]}`}
                      type="number"
                      step="any"
                      value={value}
                      onChange={(e) => vector(field, i, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}
      {draft.knnFilter && (
        <div className="form-grid two">
          <label>
            离群 K
            <input
              aria-label="离群 K"
              type="number"
              min="1"
              max="64"
              value={draft.knnFilter.k}
              onChange={(e) =>
                patch({ knnFilter: { ...draft.knnFilter!, k: Number(e.target.value) } })
              }
            />
          </label>
          <label>
            标准差比例
            <input
              aria-label="标准差比例"
              type="number"
              min="0"
              max="5"
              step="0.1"
              value={draft.knnFilter.stdRatio}
              onChange={(e) =>
                patch({ knnFilter: { ...draft.knnFilter!, stdRatio: Number(e.target.value) } })
              }
            />
          </label>
        </div>
      )}
      {!enabled && (
        <p className="warning-message">
          几何合同不满足点云条件：检查 RGB/深度尺寸、pinhole 内参、校正与 registered_to_rgb。
        </p>
      )}
      {!processingSpecSchema.safeParse(draft).success && (
        <p className="error-message">参数范围无效，请检查 ROI、深度/XYZ 范围与点数预算。</p>
      )}
      <div className="button-row">
        <button
          type="button"
          className="primary"
          disabled={
            !enabled || busy !== null || !dirty || !processingSpecSchema.safeParse(draft).success
          }
          onClick={() => void derive(workbench)}
        >
          <Play size={16} />
          {busy ? "处理中" : applied ? "应用新处理" : "应用处理"}
        </button>
        <span className="muted">
          {applied ? `当前 ${applied.maxPoints.toLocaleString()} 点预算` : "应用后可测量与导出"}
        </span>
      </div>
    </section>
  );
}
