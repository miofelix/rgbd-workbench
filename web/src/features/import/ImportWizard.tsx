import { FileUp, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  commitImport,
  confirmImport,
  getImport,
  probeImport,
} from "../../api/client";
import type {
  MetadataPayload,
  ProbeResponse,
  SceneSummary,
} from "../../api/types";

type DepthRepresentation = "z_depth" | "relative_z";

function depthSemanticsIssue(metadata: MetadataPayload): string | null {
  if (!metadata.representation) return "请选择深度表示。";
  if (metadata.representation === "relative_z") {
    if (metadata.unit !== "unitless") return "相对 Z 必须明确选择“无单位”。";
    if (metadata.scale_to_meter !== undefined)
      return "相对 Z 不能填写米制比例。";
    return null;
  }
  if (metadata.representation === "z_depth") {
    const hasScale =
      typeof metadata.scale_to_meter === "number" &&
      metadata.scale_to_meter > 0;
    if (hasScale && metadata.unit !== undefined)
      return "请只填写单位或米制比例，不能同时填写。";
    if (!hasScale && metadata.unit !== "m" && metadata.unit !== "mm") {
      return "Z 深度必须明确选择米/毫米，或提供米制比例。";
    }
    return null;
  }
  return "当前表示暂不支持点云处理。";
}

function metadataFromScene(scene: SceneSummary): MetadataPayload {
  const camera = scene.camera;
  const cameraWidth = camera?.width;
  const cameraHeight = camera?.height;
  const cameraFx = camera?.fx;
  const cameraFy = camera?.fy;
  const cameraCx = camera?.cx;
  const cameraCy = camera?.cy;
  let cameraMetadata: MetadataPayload["camera"];
  if (
    camera &&
    typeof cameraWidth === "number" &&
    typeof cameraHeight === "number" &&
    typeof cameraFx === "number" &&
    typeof cameraFy === "number" &&
    typeof cameraCx === "number" &&
    typeof cameraCy === "number"
  ) {
    cameraMetadata = {
      model: "pinhole",
      width: cameraWidth,
      height: cameraHeight,
      fx: cameraFx,
      fy: cameraFy,
      cx: cameraCx,
      cy: cameraCy,
      distortion_model: camera.distortion_model ?? "unknown",
    };
  }
  return {
    display_name:
      scene.display_name === "Untitled Scene" ? undefined : scene.display_name,
    representation: scene.depth_spec?.representation,
    unit: scene.depth_spec?.unit ?? undefined,
    scale_to_meter: scene.depth_spec?.scale_to_meter ?? undefined,
    invalid_values: scene.depth_spec?.invalid_values,
    valid_min: scene.depth_spec?.valid_min ?? undefined,
    valid_max: scene.depth_spec?.valid_max ?? undefined,
    camera: cameraMetadata,
    alignment: scene.alignment?.state
      ? {
          state: scene.alignment.state as
            "registered_to_rgb" | "unregistered" | "unknown",
        }
      : undefined,
  };
}

interface ImportWizardProps {
  onCommitted: (scene: SceneSummary) => void;
  onCancel?: () => void;
  onProbed?: (probe: ProbeResponse) => void;
  initialImportId?: string;
  activeSceneId?: string | null;
}

export function ImportWizard({
  onCommitted,
  onCancel,
  onProbed,
  initialImportId,
  activeSceneId,
}: ImportWizardProps): React.JSX.Element {
  const [rgb, setRgb] = useState<File | null>(null);
  const [depth, setDepth] = useState<File | null>(null);
  const [manifest, setManifest] = useState<File | undefined>();
  const [probe, setProbe] = useState<ProbeResponse | null>(null);
  const [metadata, setMetadata] = useState<MetadataPayload>({});
  const [invalidValuesInput, setInvalidValuesInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedImportId, setConfirmedImportId] = useState<string | null>(
    null,
  );
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [geometryExpanded, setGeometryExpanded] = useState(true);
  const request = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const rgbInput = useRef<HTMLInputElement | null>(null);
  const depthInput = useRef<HTMLInputElement | null>(null);
  const manifestInput = useRef<HTMLInputElement | null>(null);

  useEffect(
    () => () => {
      request.current?.abort();
      revision.current += 1;
    },
    [],
  );

  const beginRequest = (): {
    controller: AbortController;
    requestRevision: number;
  } => {
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
    setBusy(false);
  }, [activeSceneId]);

  const acceptProbe = (
    result: ProbeResponse,
    hydrateMetadata: boolean,
    resetSections = false,
  ): void => {
    setProbe(result);
    const sceneMetadata = result.scene ? metadataFromScene(result.scene) : {};
    if (hydrateMetadata && result.scene) {
      setMetadata(sceneMetadata);
      setInvalidValuesInput(sceneMetadata.invalid_values?.join(", ") ?? "");
    }
    if (resetSections) setGeometryExpanded(!sceneMetadata.camera);
    setConfirmedImportId(result.scene?.depth_spec ? result.import_id : null);
    setMetadataDirty(false);
    onProbed?.(result);
  };

  const resetProbeDraft = (): void => {
    request.current?.abort();
    revision.current += 1;
    setBusy(false);
    setProbe(null);
    setMetadata({});
    setInvalidValuesInput("");
    setConfirmedImportId(null);
    setMetadataDirty(false);
    setError(null);
  };

  const runProbe = async (
    nextRgb: File | null,
    nextDepth: File | null,
    nextManifest?: File,
  ): Promise<void> => {
    if (!nextRgb || !nextDepth) {
      resetProbeDraft();
      return;
    }
    setProbe(null);
    setMetadata({});
    setInvalidValuesInput("");
    setConfirmedImportId(null);
    setMetadataDirty(false);
    const { controller, requestRevision } = beginRequest();
    setBusy(true);
    setError(null);
    try {
      const result = await probeImport({
        rgb: nextRgb,
        depth: nextDepth,
        manifest: nextManifest,
        signal: controller.signal,
      });
      if (requestRevision === revision.current && !controller.signal.aborted) {
        acceptProbe(result, true, true);
      }
    } catch (cause) {
      if (requestRevision === revision.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "导入探测失败");
      }
    } finally {
      if (requestRevision === revision.current && !controller.signal.aborted)
        setBusy(false);
    }
  };

  const updateMetadata = (patch: MetadataPayload): void => {
    setMetadata((current) => ({ ...current, ...patch }));
    setConfirmedImportId(null);
    setMetadataDirty(true);
    setError(null);
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
    distortion_model: "unknown" as const,
  };

  const updateCamera = (
    field: "width" | "height" | "fx" | "fy" | "cx" | "cy" | "distortion_model",
    value: string,
  ): void => {
    updateMetadata({
      camera: {
        ...cameraDraft,
        [field]:
          field === "distortion_model"
            ? (value as "none" | "unknown")
            : Number(value),
      },
    });
  };

  useEffect(() => {
    if (!initialImportId) return;
    const { controller, requestRevision } = beginRequest();
    setBusy(true);
    void getImport(initialImportId, controller.signal)
      .then((result) => {
        if (
          requestRevision === revision.current &&
          !controller.signal.aborted
        ) {
          acceptProbe(result, true, true);
        }
      })
      .catch((cause: unknown) => {
        if (
          requestRevision === revision.current &&
          !controller.signal.aborted
        ) {
          setError(cause instanceof Error ? cause.message : "无法恢复导入会话");
        }
      })
      .finally(() => {
        if (requestRevision === revision.current && !controller.signal.aborted)
          setBusy(false);
      });
  }, [initialImportId, onProbed]);

  const confirm = async (): Promise<void> => {
    if (!probe) return;
    const semanticsError = depthSemanticsIssue(metadata) ?? invalidValuesIssue;
    if (semanticsError) {
      setError(semanticsError);
      return;
    }
    const { controller, requestRevision } = beginRequest();
    setBusy(true);
    setError(null);
    try {
      const result = await confirmImport(
        probe.import_id,
        metadata,
        controller.signal,
      );
      if (requestRevision === revision.current && !controller.signal.aborted) {
        acceptProbe(result, Boolean(result.scene));
        if (!result.scene?.depth_spec) setConfirmedImportId(result.import_id);
      }
    } catch (cause) {
      if (requestRevision === revision.current && !controller.signal.aborted) {
        setError(
          cause instanceof ApiError && cause.diagnostics[0]?.message
            ? cause.diagnostics[0].message
            : cause instanceof Error
              ? cause.message
              : "参数确认失败",
        );
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
        setProbe(null);
        setRgb(null);
        setDepth(null);
        setManifest(undefined);
        setMetadata({});
        setInvalidValuesInput("");
        setConfirmedImportId(null);
        setMetadataDirty(false);
        if (rgbInput.current) rgbInput.current.value = "";
        if (depthInput.current) depthInput.current.value = "";
        if (manifestInput.current) manifestInput.current.value = "";
        onCommitted(result.scene);
      }
    } catch (cause) {
      if (requestRevision === revision.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Scene 保存失败");
      }
    } finally {
      if (requestRevision === revision.current) setBusy(false);
    }
  };

  const invalidValuesIssue = metadata.invalid_values?.some(
    (value) => !Number.isFinite(value),
  )
    ? "无效值必须是有限数值，用逗号分隔，例如 0, -9999。"
    : null;
  const semanticsError = depthSemanticsIssue(metadata) ?? invalidValuesIssue;
  const semanticsConfirmed = Boolean(
    probe && confirmedImportId === probe.import_id,
  );
  const diagnostics = [
    ...(probe?.diagnostics ?? []),
    ...(depthCandidate?.diagnostics ?? []),
  ]
    .filter(
      (item) =>
        !(semanticsConfirmed && item.code === "DEPTH_SEMANTICS_REQUIRED"),
    )
    .filter(
      (item, index, items) =>
        items.findIndex((other) => other.code === item.code) === index,
    );
  const manifestName = manifest?.name ?? probe?.manifest?.source.filename;

  return (
    <section className="import-card" aria-labelledby="import-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">导入文件</span>
          <h2 id="import-title">导入一组 RGB-D</h2>
          <p>原始文件只读。单位、深度语义和几何信息都需要明确确认。</p>
        </div>
        <div className="import-header-actions">
          {onCancel && (
            <button
              type="button"
              className="secondary compact"
              onClick={() => {
                request.current?.abort();
                revision.current += 1;
                setBusy(false);
                onCancel();
              }}
            >
              取消
            </button>
          )}
          <FileUp aria-hidden="true" size={21} />
        </div>
      </div>
      <div className="file-grid">
        <label className="file-drop" htmlFor="rgb-file">
          <span>RGB 图像</span>
          <strong>
            {rgb?.name ??
              probe?.candidates.rgb?.source.filename ??
              "选择 PNG / JPEG / WebP / TIFF"}
          </strong>
          <input
            ref={rgbInput}
            className="file-input"
            id="rgb-file"
            aria-label="RGB 图像文件"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/tiff"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setRgb(file);
              void runProbe(file, depth, manifest);
            }}
          />
        </label>
        <label className="file-drop" htmlFor="depth-file">
          <span>深度数据</span>
          <strong>
            {depth?.name ??
              probe?.candidates.depth?.source.filename ??
              "选择 PNG / TIFF / NPY / NPZ / PFM"}
          </strong>
          <input
            ref={depthInput}
            className="file-input"
            id="depth-file"
            aria-label="深度数据文件"
            type="file"
            accept="image/png,image/tiff,.npy,.npz,.pfm,.raw,.bin"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setDepth(file);
              void runProbe(rgb, file, manifest);
            }}
          />
        </label>
      </div>
      <div className="manifest-controls">
        <label className="manifest-picker" htmlFor="manifest-file">
          <span>可选 manifest</span>
          <strong className="manifest-name">
            {manifestName ?? "选择 JSON / YAML"}
          </strong>
          <input
            ref={manifestInput}
            className="file-input"
            id="manifest-file"
            aria-label="可选 manifest 文件"
            type="file"
            accept="application/json,.json,.yaml,.yml"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setManifest(file);
              void runProbe(rgb, depth, file);
            }}
          />
        </label>
        {manifest && (
          <button
            type="button"
            className="secondary compact"
            onClick={() => {
              setManifest(undefined);
              if (manifestInput.current) manifestInput.current.value = "";
              void runProbe(rgb, depth, undefined);
            }}
          >
            移除 manifest
          </button>
        )}
      </div>
      <p className="manifest-hint">
        manifest 必须使用 RGB-D Lab 标准格式；文件名和数值范围不会推断深度单位。
      </p>
      {busy && (
        <p className="inline-status">
          <LoaderCircle className="spin" size={15} /> 正在读取并检查文件…
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {error && !probe && rgb && depth && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void runProbe(rgb, depth, manifest)}
        >
          重新探测
        </button>
      )}
      {probe && (
        <fieldset className="probe-panel import-fields" disabled={busy}>
          <div className="probe-summary">
            <div>
              <span>输入状态</span>
              <strong>
                {probe.capabilities.image_inspection ? "可查看" : "需要修复"}
              </strong>
            </div>
            <div>
              <span>米制点云</span>
              <strong>
                {probe.capabilities.metric_pointcloud ? "可用" : "待补全"}
              </strong>
            </div>
            <div>
              <span>相对点云</span>
              <strong>
                {probe.capabilities.relative_pointcloud ? "可用" : "待补全"}
              </strong>
            </div>
          </div>
          {diagnostics.length > 0 && (
            <div className="diagnostic-list" aria-label="导入诊断">
              {diagnostics.map((item) => (
                <div className={`diagnostic ${item.severity}`} key={item.code}>
                  <strong>{item.code}</strong>
                  <span>{item.message}</span>
                </div>
              ))}
            </div>
          )}
          <div className="semantic-grid">
            <label>
              显示名称
              <input
                aria-label="Scene 显示名称"
                value={metadata.display_name ?? ""}
                placeholder="例如：桌面样例"
                onChange={(event) =>
                  updateMetadata({
                    display_name: event.target.value || undefined,
                  })
                }
              />
            </label>
            <label
              className={
                semanticsError && !metadata.representation
                  ? "field-invalid"
                  : undefined
              }
            >
              深度表示
              <select
                aria-label="深度表示"
                aria-invalid={Boolean(
                  semanticsError && !metadata.representation,
                )}
                required
                value={metadata.representation ?? ""}
                onChange={(event) => {
                  const representation = event.target.value as
                    DepthRepresentation | "";
                  if (representation === "relative_z") {
                    updateMetadata({
                      representation,
                      unit: "unitless",
                      scale_to_meter: undefined,
                    });
                  } else {
                    updateMetadata({
                      representation: representation || undefined,
                      unit:
                        metadata.unit === "unitless"
                          ? undefined
                          : metadata.unit,
                    });
                  }
                }}
              >
                <option value="">请选择</option>
                <option value="z_depth">Z 深度</option>
                <option value="relative_z">相对 Z（无单位）</option>
              </select>
            </label>
            <label
              className={
                semanticsError && metadata.representation
                  ? "field-invalid"
                  : undefined
              }
            >
              单位
              <select
                aria-label="单位"
                aria-invalid={Boolean(
                  semanticsError && metadata.representation,
                )}
                required={
                  metadata.representation !== "z_depth" ||
                  metadata.scale_to_meter === undefined
                }
                value={
                  metadata.scale_to_meter !== undefined
                    ? "custom"
                    : (metadata.unit ?? "")
                }
                onChange={(event) =>
                  updateMetadata({
                    unit:
                      event.target.value === "custom"
                        ? undefined
                        : event.target.value || undefined,
                    scale_to_meter:
                      event.target.value === "custom"
                        ? (metadata.scale_to_meter ?? 0)
                        : undefined,
                  })
                }
              >
                <option value="">请选择</option>
                <option
                  value="m"
                  disabled={metadata.representation === "relative_z"}
                >
                  米（m）
                </option>
                <option
                  value="mm"
                  disabled={metadata.representation === "relative_z"}
                >
                  毫米（mm）
                </option>
                <option
                  value="unitless"
                  disabled={metadata.representation === "z_depth"}
                >
                  无单位
                </option>
                <option
                  value="custom"
                  disabled={metadata.representation !== "z_depth"}
                >
                  自定义米制比例
                </option>
              </select>
            </label>
            {metadata.scale_to_meter !== undefined && (
              <label>
                每单位对应米数
                <input
                  aria-label="米制比例"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="例如 0.001"
                  value={metadata.scale_to_meter ?? ""}

                  onChange={(event) =>
                    updateMetadata({
                      scale_to_meter: event.target.value
                        ? Number(event.target.value)
                        : 0,
                    })
                  }
                />
              </label>
            )}
          </div>
          {semanticsError ? (
            <p className="field-hint error" role="status">
              {semanticsError} 确认前不会猜测这些信息。
            </p>
          ) : !semanticsConfirmed ? (
            <p className="field-hint" role="status">
              已填写语义；点击“确认参数”后才会用于点云。
            </p>
          ) : null}
          <details
            className="metadata-section"
            open={geometryExpanded}
            onToggle={(event) => setGeometryExpanded(event.currentTarget.open)}
          >
            <summary>
              几何信息 <span>点云需要</span>
            </summary>
            <label className="alignment-field">
              对齐状态
              <select
                aria-label="对齐状态"
                value={metadata.alignment?.state ?? "unknown"}
                onChange={(event) =>
                  updateMetadata({
                    alignment: {
                      state: event.target.value as
                        "registered_to_rgb" | "unregistered" | "unknown",
                    },
                  })
                }
              >
                <option value="unknown">未确认</option>
                <option value="registered_to_rgb">已对齐到 RGB</option>
                <option value="unregistered">未对齐</option>
              </select>
            </label>
            <fieldset className="camera-fields">
              <legend>相机内参（可选，点云需要）</legend>
              <div className="camera-grid">
                {(["width", "height", "fx", "fy", "cx", "cy"] as const).map(
                  (field) => (
                    <label key={field}>
                      {field.toUpperCase()}
                      <input
                        aria-label={`相机 ${field}`}
                        type="number"
                        min={field === "cx" || field === "cy" ? undefined : "0"}
                        step="any"
                        value={cameraDraft[field] ?? ""}
                        onChange={(event) =>
                          updateCamera(field, event.target.value)
                        }
                      />
                    </label>
                  ),
                )}
              </div>
              <label className="camera-distortion">
                畸变模型
                <select
                  aria-label="相机畸变模型"
                  value={cameraDraft.distortion_model}
                  onChange={(event) =>
                    updateCamera("distortion_model", event.target.value)
                  }
                >
                  <option value="unknown">未确认</option>
                  <option value="none">无畸变（已校正）</option>
                </select>
              </label>
            </fieldset>
            <label className="orientation-check">
              <input
                type="checkbox"
                checked={metadata.orientation_confirmed ?? false}
                onChange={(event) =>
                  updateMetadata({
                    orientation_confirmed: event.target.checked,
                  })
                }
              />
              我已确认 RGB 与深度使用相同的图像方向
            </label>
          </details>
          <details className="metadata-section">
            <summary>
              更多深度设置 <span>可选</span>
            </summary>
            <div className="semantic-grid">
              <label>
                无效值（可选）
                <input
                  aria-label="深度无效值"
                  type="text"
                  placeholder="例如 0"
                  value={invalidValuesInput}
                  aria-invalid={Boolean(invalidValuesIssue)}
                  onChange={(event) => {
                    const value = event.target.value;
                    setInvalidValuesInput(value);
                    updateMetadata({
                      invalid_values: value.trim()
                        ? value
                            .split(",")
                            .filter((part) => part.trim() !== "")
                            .map(Number)
                        : [],
                    });
                  }}
                />
              </label>
            </div>
          </details>
          <div className="wizard-actions">
            <span className="security-note">
              <ShieldCheck size={15} /> 本地处理 · 不上传
            </span>
            <button
              type="button"
              className="secondary"
              onClick={() => void confirm()}
              disabled={busy || Boolean(semanticsError)}
            >
              确认参数
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void commit()}
              disabled={
                busy || metadataDirty || !probe.capabilities.image_inspection
              }
              title={
                metadataDirty
                  ? "参数已修改，请先确认"
                  : semanticsConfirmed
                    ? "保存已确认的 Scene"
                    : "保存后仅保留二维查看能力，点云仍需确认深度语义"
              }
            >
              保存 Scene
            </button>
          </div>
        </fieldset>
      )}
    </section>
  );
}
