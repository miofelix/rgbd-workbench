import { FileUp, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { commitImport, confirmImport, getImport, probeImport } from "../../api/client";
import type { MetadataPayload, ProbeResponse, SceneSummary } from "../../api/types";

interface ImportWizardProps {
  onCommitted: (scene: SceneSummary) => void;
  onProbed?: (probe: ProbeResponse) => void;
  initialImportId?: string;
  activeSceneId?: string | null;
}

export function ImportWizard({ onCommitted, onProbed, initialImportId, activeSceneId }: ImportWizardProps): React.JSX.Element {
  const [rgb, setRgb] = useState<File | null>(null);
  const [depth, setDepth] = useState<File | null>(null);
  const [manifest, setManifest] = useState<File | undefined>();
  const [probe, setProbe] = useState<ProbeResponse | null>(null);
  const [metadata, setMetadata] = useState<MetadataPayload>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const revision = useRef(0);

  const beginRequest = (): { controller: AbortController; requestRevision: number } => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    revision.current += 1;
    return { controller, requestRevision: revision.current };
  };

  useEffect(() => {
    if (activeSceneId === undefined) return;
    request.current?.abort();
    revision.current += 1;
  }, [activeSceneId]);

  const runProbe = async (nextRgb: File | null, nextDepth: File | null): Promise<void> => {
    if (!nextRgb || !nextDepth) return;
    const { controller, requestRevision } = beginRequest();
    setBusy(true);
    setError(null);
    try {
      const result = await probeImport({ rgb: nextRgb, depth: nextDepth, manifest, signal: controller.signal });
      if (requestRevision === revision.current && !controller.signal.aborted) {
        setProbe(result);
        onProbed?.(result);
      }
    } catch (cause) {
      if (requestRevision === revision.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "导入探测失败");
      }
    } finally {
      if (requestRevision === revision.current && !controller.signal.aborted) setBusy(false);
    }
  };

  const updateMetadata = (patch: MetadataPayload): void => {
    setMetadata((current) => ({ ...current, ...patch }));
  };

  const depthCandidate = probe?.candidates.depth;

  const cameraDraft = metadata.camera ?? {
    model: "pinhole" as const,
    width: depthCandidate?.source.width ?? 0,
    height: depthCandidate?.source.height ?? 0,
    fx: 0,
    fy: 0,
    cx: 0,
    cy: 0,
    distortion_model: "none" as const,
  };

  const updateCamera = (field: "width" | "height" | "fx" | "fy" | "cx" | "cy", value: string): void => {
    updateMetadata({ camera: { ...cameraDraft, [field]: Number(value) } });
  };

  useEffect(() => {
    if (!initialImportId) return;
    const { controller, requestRevision } = beginRequest();
    setBusy(true);
    void getImport(initialImportId, controller.signal)
      .then((result) => {
        if (requestRevision === revision.current && !controller.signal.aborted) {
          setProbe(result);
          onProbed?.(result);
        }
      })
      .catch((cause: unknown) => {
        if (requestRevision === revision.current && !controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "无法恢复导入会话");
        }
      })
      .finally(() => {
        if (requestRevision === revision.current && !controller.signal.aborted) setBusy(false);
      });
  }, [initialImportId, onProbed]);

  const confirm = async (): Promise<void> => {
    if (!probe) return;
    const { controller, requestRevision } = beginRequest();
    setBusy(true);
    setError(null);
    try {
      const result = await confirmImport(probe.import_id, metadata, controller.signal);
      if (requestRevision === revision.current && !controller.signal.aborted) {
        setProbe(result);
        onProbed?.(result);
      }
    } catch (cause) {
      if (requestRevision === revision.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "参数确认失败");
      }
    } finally {
      if (requestRevision === revision.current) setBusy(false);
    }
  };

  const commit = async (): Promise<void> => {
    if (!probe) return;
    const { controller, requestRevision } = beginRequest();
    setBusy(true);
    setError(null);
    try {
      const result = await commitImport(probe.import_id, controller.signal);
      if (requestRevision === revision.current && !controller.signal.aborted) {
        onCommitted(result.scene);
        setProbe(null);
        setRgb(null);
        setDepth(null);
      }
    } catch (cause) {
      if (requestRevision === revision.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Scene 保存失败");
      }
    } finally {
      if (requestRevision === revision.current) setBusy(false);
    }
  };

  const diagnostics = [
    ...(probe?.diagnostics ?? []),
    ...(depthCandidate?.diagnostics ?? []),
  ].filter((item, index, items) => items.findIndex((other) => other.code === item.code) === index);

  return (
    <section className="import-card" aria-labelledby="import-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SOURCE INTAKE</span>
          <h2 id="import-title">导入一组 RGB-D</h2>
          <p>原始文件只读。单位、深度语义和几何信息都需要明确确认。</p>
        </div>
        <FileUp aria-hidden="true" size={21} />
      </div>
      <div className="file-grid">
        <label className="file-drop" htmlFor="rgb-file">
          <span>RGB 图像</span>
          <strong>{rgb?.name ?? "选择 PNG / JPEG / WebP / TIFF"}</strong>
          <input
            id="rgb-file"
            aria-label="RGB 图像文件"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/tiff"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setRgb(file);
              void runProbe(file, depth);
            }}
          />
        </label>
        <label className="file-drop" htmlFor="depth-file">
          <span>深度数据</span>
          <strong>{depth?.name ?? "选择 PNG / TIFF / NPY / NPZ / PFM"}</strong>
          <input
            id="depth-file"
            aria-label="深度数据文件"
            type="file"
            accept="image/png,image/tiff,.npy,.npz,.pfm,.raw,.bin"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setDepth(file);
              void runProbe(rgb, file);
            }}
          />
        </label>
      </div>
      <label className="manifest-picker" htmlFor="manifest-file">
        <span>可选 manifest</span>
        <input
          id="manifest-file"
          aria-label="可选 manifest 文件"
          type="file"
          accept="application/json,.json,.yaml,.yml"
          onChange={(event) => setManifest(event.target.files?.[0])}
        />
      </label>
      {busy && <p className="inline-status"><LoaderCircle className="spin" size={15} /> 正在读取并检查文件…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {probe && (
        <div className="probe-panel">
          <div className="probe-summary">
            <div><span>输入状态</span><strong>{probe.capabilities.image_inspection ? "可查看" : "需要修复"}</strong></div>
            <div><span>米制点云</span><strong>{probe.capabilities.metric_pointcloud ? "可用" : "待补全"}</strong></div>
            <div><span>相对点云</span><strong>{probe.capabilities.relative_pointcloud ? "可用" : "待补全"}</strong></div>
          </div>
          {diagnostics.length > 0 && (
            <div className="diagnostic-list" aria-label="导入诊断">
              {diagnostics.map((item) => (
                <div className={`diagnostic ${item.severity}`} key={item.code}>
                  <strong>{item.code}</strong><span>{item.message}</span>
                </div>
              ))}
            </div>
          )}
          <div className="semantic-grid">
            <label>深度表示
              <select
                aria-label="深度表示"
                value={metadata.representation ?? ""}
                onChange={(event) => updateMetadata({ representation: event.target.value || undefined })}
              >
                <option value="">请选择</option>
                <option value="z_depth">Z 深度</option>
                <option value="relative_z">相对 Z（无单位）</option>
              </select>
            </label>
            <label>单位
              <select
                aria-label="单位"
                value={metadata.unit ?? ""}
                onChange={(event) => updateMetadata({ unit: event.target.value || undefined })}
              >
                <option value="">请选择</option>
                <option value="m">米（m）</option>
                <option value="mm">毫米（mm）</option>
                <option value="unitless">无单位</option>
              </select>
            </label>
            <label>显示名称
              <input
                aria-label="Scene 显示名称"
                value={metadata.display_name ?? ""}
                placeholder="例如：桌面样例"
                onChange={(event) => updateMetadata({ display_name: event.target.value || undefined })}
              />
            </label>
            <label>米制比例（可选）
              <input
                aria-label="米制比例"
                type="number"
                min="0"
                step="any"
                placeholder="例如 0.001"
                value={metadata.scale_to_meter ?? ""}
                onChange={(event) => updateMetadata({ scale_to_meter: event.target.value ? Number(event.target.value) : undefined })}
              />
            </label>
            <label>无效值（可选）
              <input
                aria-label="深度无效值"
                type="text"
                placeholder="例如 0"
                value={metadata.invalid_values?.join(", ") ?? ""}
                onChange={(event) => updateMetadata({ invalid_values: event.target.value ? event.target.value.split(",").map(Number).filter(Number.isFinite) : [] })}
              />
            </label>
            <label>对齐状态
              <select
                aria-label="对齐状态"
                value={metadata.alignment?.state ?? "unknown"}
                onChange={(event) => updateMetadata({ alignment: { state: event.target.value as "registered_to_rgb" | "unregistered" | "unknown" } })}
              >
                <option value="unknown">未确认</option>
                <option value="registered_to_rgb">已对齐到 RGB</option>
                <option value="unregistered">未对齐</option>
              </select>
            </label>
          </div>
          <fieldset className="camera-fields">
            <legend>相机内参（可选，点云需要）</legend>
            <div className="camera-grid">
              {(["width", "height", "fx", "fy", "cx", "cy"] as const).map((field) => (
                <label key={field}>{field.toUpperCase()}
                  <input
                    aria-label={`相机 ${field}`}
                    type="number"
                    min="0"
                    step="any"
                    value={cameraDraft[field] || ""}
                    onChange={(event) => updateCamera(field, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <label className="orientation-check">
            <input
              type="checkbox"
              checked={metadata.orientation_confirmed ?? false}
              onChange={(event) => updateMetadata({ orientation_confirmed: event.target.checked })}
            />
            我已确认 RGB 与深度使用相同的图像方向
          </label>
          <div className="wizard-actions">
            <span className="security-note"><ShieldCheck size={15} /> 本地处理 · 不上传</span>
            <button type="button" className="secondary" onClick={() => void confirm()} disabled={busy}>确认参数</button>
            <button type="button" className="primary" onClick={() => void commit()} disabled={busy || !probe.capabilities.image_inspection}>保存 Scene</button>
          </div>
        </div>
      )}
    </section>
  );
}
