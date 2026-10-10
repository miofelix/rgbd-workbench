import { ScanLine } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { scenePreviewUrl } from "../../api/client";
import type { SceneSummary } from "../../api/types";
import { useWorkbenchStore } from "../../state/workbench";
import { ExportActions } from "../pointcloud/ExportActions";
import { MeasurementPanel } from "../pointcloud/MeasurementPanel";
import {
  PointCloudViewer,
  type PointCloudViewerHandle,
} from "../pointcloud/PointCloudViewer";
import { ProcessingPanel } from "../pointcloud/ProcessingPanel";
import { TrajectoryPanel } from "../trajectory/TrajectoryPanel";
import { DepthPreview } from "./DepthPreview";
import { LinkedImagePreview } from "./LinkedImagePreview";
import { StatisticsPanel } from "./StatisticsPanel";

interface SceneInspectorProps {
  scene: SceneSummary | null;
  mode: "inspect" | "compare" | "trajectory";
  onEditMetadata?: () => void;
  metadataBusy?: boolean;
}

export function SceneInspector({
  scene,
  mode,
  onEditMetadata,
  metadataBusy = false,
}: SceneInspectorProps): React.JSX.Element {
  const viewerRef = useRef<PointCloudViewerHandle>(null);
  const [readyViewer, setReadyViewer] = useState<string | null>(null);
  const {
    appliedDerivation,
    appliedDerivationUrls,
    selectedPoints,
    selectPoint,
    clearSelectedPoints,
    viewSpec,
    setViewSpec,
  } = useWorkbenchStore();
  const viewerKey = `${scene?.scene_id}-${appliedDerivation?.derivation_id}-${mode}`;
  const viewerReady = readyViewer === viewerKey;
  const handleReady = useCallback(
    (ready: boolean) => setReadyViewer(ready ? viewerKey : null),
    [viewerKey],
  );
  if (!scene)
    return (
      <section className="empty-workspace">
        <ScanLine size={28} />
        <h2>从一组 RGB-D 开始</h2>
        <p>选择上方“导入”，添加 RGB 图像与深度文件。</p>
      </section>
    );

  const metric = scene.capabilities?.metric_pointcloud ?? false;
  const relative = scene.capabilities?.relative_pointcloud ?? false;
  const geometryReady = metric || relative;
  const currentDerivation =
    appliedDerivation?.scene_id === scene.scene_id ? appliedDerivation : null;
  const currentUrls = currentDerivation ? appliedDerivationUrls : null;
  const sourceWidth = scene.depth.width ?? 0;
  const sourceHeight = scene.depth.height ?? 0;
  const viewer =
    currentDerivation && currentUrls ? (
      <PointCloudViewer
        ref={viewerRef}
        pointcloudUrl={currentUrls.pointcloud}
        onPointSelected={selectPoint}
        selectedPoints={selectedPoints}
        viewSpec={
          mode === "trajectory"
            ? { ...viewSpec, projection: "perspective" }
            : viewSpec
        }
        projectionLocked={mode === "trajectory"}
        onViewSpecChange={setViewSpec}
        onReadyChange={handleReady}
      />
    ) : null;
  const selectImagePixel = (pixelIndex: number): void => {
    const selected = viewerRef.current?.selectPixel(pixelIndex);
    if (selected) selectPoint(selected);
  };
  const processingPanel = (
    <ProcessingPanel
      enabled={geometryReady}
      sourceWidth={sourceWidth}
      sourceHeight={sourceHeight}
      unit={metric ? "m" : "unitless"}
    />
  );
  const processing = currentDerivation ? (
    <details className="processing-section panel">
      <summary>
        处理参数 <span>已应用 · 展开调整</span>
      </summary>
      {processingPanel}
    </details>
  ) : (
    processingPanel
  );
  const exports = currentUrls ? (
    <ExportActions
      urls={currentUrls}
      viewerRef={viewerRef}
      displayName={scene.display_name}
      ready={viewerReady}
    />
  ) : null;
  const derivationPrompt = (
    <section className="derivation-empty">
      <ScanLine size={22} />
      <div>
        <strong>
          {geometryReady ? "生成点云后开始分析" : "当前可检查二维图像"}
        </strong>
        <p>
          {geometryReady
            ? "点击“应用处理”生成点云，即可选点测量与导出。"
            : "补全数据检查中的几何信息后，可使用三维分析。"}
        </p>
      </div>
    </section>
  );

  return (
    <div className="scene-inspector">
      <div className="scene-toolbar">
        <div>
          <span className="eyebrow">当前场景</span>
          <h2>{scene.display_name}</h2>
        </div>
        <div className="scene-toolbar-actions">
          <span
            className={`capability-pill ${geometryReady ? "ready" : "pending"}`}
          >
            {metric ? "米制几何可用" : relative ? "相对几何可用" : "二维查看"}
          </span>
          {onEditMetadata && (
            <button
              type="button"
              className="secondary"
              onClick={onEditMetadata}
              disabled={metadataBusy}
              aria-label="编辑场景参数"
            >
              {metadataBusy
                ? "正在打开…"
                : geometryReady
                  ? "编辑参数"
                  : "补全参数"}
            </button>
          )}
        </div>
      </div>
      <SceneDetails
        key={scene.scene_id}
        scene={scene}
        geometryReady={geometryReady}
      />
      {mode === "inspect" && (
        <>
          <details
            className="source-section panel"
            key={`${scene.scene_id}-${Boolean(currentDerivation)}`}
            open={!currentDerivation}
          >
            <summary>
              输入图像{" "}
              <span>
                {scene.rgb.width} × {scene.rgb.height} ·{" "}
                {scene.depth_spec?.unit ?? "未确认单位"}
              </span>
            </summary>
            <SourcePreviews scene={scene} />
          </details>
          {processing}
          {viewer && currentDerivation ? (
            <div className="analysis-workspace">
              <section className="panel viewer-panel">
                <div className="panel-heading">
                  <h3>三维点云</h3>
                  <span className="viewer-meta">
                    {currentDerivation.point_count.toLocaleString()} 点 ·{" "}
                    {currentDerivation.unit}
                  </span>
                </div>
                {viewer}
              </section>
              <div className="analysis-side-stack">
                <MeasurementPanel
                  points={selectedPoints}
                  onClear={clearSelectedPoints}
                />
                {exports}
              </div>
            </div>
          ) : (
            derivationPrompt
          )}
        </>
      )}
      {mode === "compare" && (
        <>
          {processing}
          <div className="compare-grid">
            <section className="panel compare-tile">
              <div className="panel-heading">
                <h3>RGB 输入</h3>
                <span className="muted">
                  {scene.rgb.width} × {scene.rgb.height}
                </span>
              </div>
              <div className="compare-media">
                {viewer ? (
                  <LinkedImagePreview
                    src={scenePreviewUrl(scene.scene_id, "rgb")}
                    alt="RGB 输入"
                    sourceWidth={scene.rgb.width ?? sourceWidth}
                    sourceHeight={scene.rgb.height ?? sourceHeight}
                    selectedPoints={selectedPoints}
                    onPixelSelected={selectImagePixel}
                  />
                ) : (
                  <img
                    src={scenePreviewUrl(scene.scene_id, "rgb")}
                    alt="RGB 输入"
                  />
                )}
              </div>
            </section>
            <section className="panel compare-tile">
              <div className="panel-heading">
                <h3>深度输入</h3>
                <span className="muted">
                  {scene.depth_spec?.unit ?? "未确认单位"}
                </span>
              </div>
              <div className="compare-media">
                {viewer ? (
                  <LinkedImagePreview
                    src={scenePreviewUrl(scene.scene_id, "depth")}
                    alt="深度输入"
                    sourceWidth={sourceWidth}
                    sourceHeight={sourceHeight}
                    selectedPoints={selectedPoints}
                    onPixelSelected={selectImagePixel}
                  />
                ) : (
                  <img
                    src={scenePreviewUrl(scene.scene_id, "depth")}
                    alt="深度输入"
                  />
                )}
              </div>
            </section>
            <section className="panel compare-tile compare-viewer-tile">
              <div className="panel-heading">
                <h3>点云视图</h3>
                <span className="muted">
                  {currentDerivation
                    ? `${currentDerivation.point_count.toLocaleString()} 点`
                    : "待生成"}
                </span>
              </div>
              {viewer ?? derivationPrompt}
            </section>
            <section className="panel compare-tile compare-summary-tile">
              <div className="panel-heading">
                <h3>深度摘要</h3>
              </div>
              <StatisticsPanel scene={scene} />
              {viewer && (
                <MeasurementPanel
                  points={selectedPoints}
                  onClear={clearSelectedPoints}
                  embedded
                />
              )}
            </section>
          </div>
          {exports}
        </>
      )}
      {mode === "trajectory" && (
        <>
          {viewer && currentDerivation ? (
            <>
              <div className="trajectory-workspace">
                <section className="panel viewer-panel">
                  <div className="panel-heading">
                    <h3>轨迹点云</h3>
                    <span className="viewer-meta">
                      {currentDerivation.point_count.toLocaleString()} 点 ·{" "}
                      {currentDerivation.unit}
                    </span>
                  </div>
                  {viewer}
                </section>
                <TrajectoryPanel
                  derivation={currentDerivation}
                  viewerRef={viewerRef}
                  viewerReady={viewerReady}
                />
              </div>
              {exports}
            </>
          ) : (
            <>
              {processing}
              <section className="mode-placeholder panel">
                <h3>轨迹预览</h3>
                <p>先应用点云处理，再选择轨迹预设预览相机视角。</p>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function SceneDetails({
  scene,
  geometryReady,
}: {
  scene: SceneSummary;
  geometryReady: boolean;
}): React.JSX.Element {
  const rows: Array<[string, string, boolean]> = [
    [
      "RGB / 深度尺寸",
      `${scene.rgb.width ?? "—"} × ${scene.rgb.height ?? "—"} / ${scene.depth.width ?? "—"} × ${scene.depth.height ?? "—"}`,
      scene.rgb.width === scene.depth.width &&
        scene.rgb.height === scene.depth.height,
    ],
    [
      "深度表示",
      scene.depth_spec?.representation ?? "未确认",
      Boolean(scene.depth_spec),
    ],
    [
      "深度单位",
      scene.depth_spec?.unit ??
        (scene.depth_spec?.scale_to_meter
          ? `比例 ${scene.depth_spec.scale_to_meter} m`
          : "未确认"),
      Boolean(scene.depth_spec?.unit || scene.depth_spec?.scale_to_meter),
    ],
    ["相机内参", scene.camera ? "已提供" : "未提供", Boolean(scene.camera)],
    [
      "图像对齐",
      scene.alignment?.state === "registered_to_rgb"
        ? "已对齐到 RGB"
        : "未确认或未对齐",
      scene.alignment?.state === "registered_to_rgb",
    ],
    [
      "畸变",
      scene.camera?.distortion_model === "none" ? "已校正" : "未确认",
      scene.camera?.distortion_model === "none",
    ],
  ];
  return (
    <details className="scene-details panel" open={!geometryReady}>
      <summary>
        数据检查{" "}
        <span>{geometryReady ? "几何信息已确认" : "请检查几何信息"}</span>
      </summary>
      <div className="scene-details-grid">
        <div className="contract-list">
          {rows.map(([label, value, ok]) => (
            <div className="contract-row" key={label}>
              <span>{label}</span>
              <strong className={ok ? "ok" : "pending"}>
                {ok ? "✓" : "—"} {value}
              </strong>
            </div>
          ))}
        </div>
        <div>
          <StatisticsPanel scene={scene} />
        </div>
      </div>
      {scene.diagnostics?.length ? (
        <div className="diagnostic-list" aria-label="场景诊断">
          {scene.diagnostics.map((item) => (
            <div className={`diagnostic ${item.severity}`} key={item.code}>
              <strong>{item.message}</strong>
              {item.hint && <span>{item.hint}</span>}
            </div>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function SourcePreviews({ scene }: { scene: SceneSummary }): React.JSX.Element {
  return (
    <div className="source-previews">
      <div className="preview-frame rgb-preview">
        <img src={scenePreviewUrl(scene.scene_id, "rgb")} alt="RGB 图像" />
        <span className="preview-label">
          RGB · {scene.rgb.width} × {scene.rgb.height}
        </span>
      </div>
      <DepthPreview
        src={scenePreviewUrl(scene.scene_id, "depth")}
        label={`深度 · ${scene.depth_spec?.unit ?? "未确认单位"}`}
      />
    </div>
  );
}
