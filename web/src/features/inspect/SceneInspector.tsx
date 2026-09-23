import { Crosshair, ScanLine } from "lucide-react";
import { useRef } from "react";

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
import { DepthPreview } from "./DepthPreview";
import { StatisticsPanel } from "./StatisticsPanel";

interface SceneInspectorProps {
  scene: SceneSummary | null;
  mode: "inspect" | "compare" | "trajectory";
}

export function SceneInspector({
  scene,
  mode,
}: SceneInspectorProps): React.JSX.Element {
  const viewerRef = useRef<PointCloudViewerHandle>(null);
  const {
    appliedDerivation,
    appliedDerivationUrls,
    selectedPoints,
    selectPoint,
    clearSelectedPoints,
    viewSpec,
    setViewSpec,
  } = useWorkbenchStore();

  if (!scene) {
    return (
      <section className="empty-workspace">
        <div className="empty-icon">
          <ScanLine size={28} />
        </div>
        <span className="eyebrow">READY WHEN YOU ARE</span>
        <h2>从一组 RGB-D 开始</h2>
        <p>导入后，先检查二维数据与深度语义，再逐步解锁点云和轨迹能力。</p>
      </section>
    );
  }

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
        viewSpec={viewSpec}
        onViewSpecChange={setViewSpec}
      />
    ) : null;

  return (
    <div className="scene-inspector">
      <div className="scene-toolbar">
        <div>
          <span className="eyebrow">SCENE INSPECTOR</span>
          <h2>{scene.display_name}</h2>
        </div>
        <span
          className={`capability-pill ${geometryReady ? "ready" : "pending"}`}
        >
          {metric ? "米制几何可用" : relative ? "相对几何可用" : "待补全"}
        </span>
      </div>

      {mode === "inspect" && (
        <>
          <SourcePreviews scene={scene} />
          <ProcessingPanel
            enabled={geometryReady}
            sourceWidth={sourceWidth}
            sourceHeight={sourceHeight}
          />
          {currentDerivation && currentUrls ? (
            <div className="analysis-workspace">
              <section className="panel viewer-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">APPLIED DERIVATION</span>
                    <h3>三维点云</h3>
                  </div>
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
                <ExportActions
                  urls={currentUrls}
                  viewerRef={viewerRef}
                  displayName={scene.display_name}
                />
              </div>
            </div>
          ) : (
            <section className="derivation-empty">
              <ScanLine size={22} />
              <div>
                <strong>尚未应用点云处理</strong>
                <p>
                  确认参数后应用，三维查看、测量和静态导出会使用同一派生结果。
                </p>
              </div>
            </section>
          )}
          <div className="inspection-grid">
            <section className="panel compact-panel">
              <div className="panel-heading">
                <h3>查看状态</h3>
                <Crosshair size={17} />
              </div>
              <div className="status-rows">
                <div>
                  <span>坐标基准</span>
                  <strong>{scene.frame_id} frame</strong>
                </div>
                <div>
                  <span>深度表示</span>
                  <strong>
                    {scene.depth_spec?.representation ?? "未确认"}
                  </strong>
                </div>
                <div>
                  <span>对齐</span>
                  <strong>{scene.alignment?.state ?? "未确认"}</strong>
                </div>
                <div>
                  <span>源文件</span>
                  <strong>只读</strong>
                </div>
              </div>
            </section>
            <section className="panel compact-panel statistics-panel-inline">
              <div className="panel-heading">
                <h3>深度摘要</h3>
                <span className="muted">当前输入</span>
              </div>
              <StatisticsPanel scene={scene} />
            </section>
          </div>
        </>
      )}

      {mode === "compare" && (
        <>
          <ProcessingPanel
            enabled={geometryReady}
            sourceWidth={sourceWidth}
            sourceHeight={sourceHeight}
          />
          {currentDerivation && currentUrls ? (
            <>
              <div className="compare-grid">
                <section className="panel compare-tile">
                  <div className="panel-heading">
                    <h3>RGB 输入</h3>
                    <span className="muted">
                      {scene.rgb.width} × {scene.rgb.height}
                    </span>
                  </div>
                  <div className="compare-media">
                    <img
                      src={scenePreviewUrl(scene.scene_id, "rgb")}
                      alt="RGB 输入"
                    />
                  </div>
                </section>
                <section className="panel compare-tile">
                  <div className="panel-heading">
                    <h3>深度输入</h3>
                    <span className="muted">{scene.depth_spec?.unit}</span>
                  </div>
                  <div className="compare-media">
                    <img
                      src={scenePreviewUrl(scene.scene_id, "depth")}
                      alt="深度输入"
                    />
                  </div>
                </section>
                <section className="panel compare-tile compare-viewer-tile">
                  <div className="panel-heading">
                    <h3>点云视图</h3>
                    <span className="muted">
                      {currentDerivation.point_count.toLocaleString()} 点
                    </span>
                  </div>
                  {viewer}
                </section>
                <section className="panel compare-tile compare-summary-tile">
                  <div className="panel-heading">
                    <h3>深度摘要</h3>
                    <span className="muted">联动状态</span>
                  </div>
                  <StatisticsPanel scene={scene} />
                  <MeasurementPanel
                    points={selectedPoints}
                    onClear={clearSelectedPoints}
                    embedded
                  />
                </section>
              </div>
              <ExportActions
                urls={currentUrls}
                viewerRef={viewerRef}
                displayName={scene.display_name}
              />
            </>
          ) : (
            <section className="mode-placeholder panel">
              <span className="eyebrow">DERIVATION REQUIRED</span>
              <h3>四视图对照</h3>
              <p>
                先应用点云处理，RGB、深度、三维和统计将共享同一派生与选点状态。
              </p>
            </section>
          )}
        </>
      )}

      {mode === "trajectory" && (
        <section className="mode-placeholder panel">
          <span className="eyebrow">M3 CAPABILITY GATE</span>
          <h3>轨迹与视频导出</h3>
          <p>轨迹编辑与视频导出属于 M3，将复用当前 applied derivation。</p>
          <span className="coming-pill">即将解锁</span>
        </section>
      )}
    </div>
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
        label={`DEPTH · ${scene.depth_spec?.unit ?? "未确认"}`}
      />
    </div>
  );
}
