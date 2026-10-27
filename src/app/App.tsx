import { useEffect, useMemo, useRef } from "react";
import {
  Database,
  Download,
  LayoutGrid,
  LockKeyhole,
  Plus,
  Route,
  Settings2,
  Trash2,
} from "lucide-react";
import { Workbench } from "@/application/workbench";
import { BrowserLibrary } from "@/persistence/browser-library";
import { WorkerProcessor } from "@/compute/worker/client";
import { useWorkbench } from "./state";
import { ImportPanel } from "@/features/import/ImportPanel";
import { SourcePreviews } from "@/features/inspect/SourcePreviews";
import { StatisticsPanel } from "@/features/inspect/StatisticsPanel";
import { selectedPointForPixel } from "@/viewer/pointcloud-scene";
import { ProcessingPanel } from "@/features/pointcloud/ProcessingPanel";
import { ViewControls } from "@/features/pointcloud/ViewControls";
import { MeasurementPanel } from "@/features/pointcloud/MeasurementPanel";
import { ExportActions } from "@/features/pointcloud/ExportActions";
import { PointCloudViewer, type ViewerHandle } from "@/features/pointcloud/PointCloudViewer";
import { TrajectoryPanel } from "@/features/trajectory/TrajectoryPanel";
import { capabilityReport } from "@/domain/capabilities";
import "./app.css";

export function App(): React.JSX.Element {
  const workbench = useMemo(() => new Workbench(new BrowserLibrary(), new WorkerProcessor()), []);
  const {
    scenes,
    scene,
    previews,
    mode,
    derivation,
    selected,
    view,
    busy,
    error,
    path,
    render,
    trajectoryFrame,
    boot,
    choose,
    setMode,
    select,
    remove,
    archive,
  } = useWorkbench();
  const viewerRef = useRef<ViewerHandle>(null);
  useEffect(() => {
    void boot(workbench);
    return () => workbench.dispose();
  }, [workbench, boot]);
  const capabilities = scene ? capabilityReport(scene) : null;
  const selectPixel = (pixelIndex: number): void => {
    if (derivation) {
      const point = selectedPointForPixel(derivation.cloud, pixelIndex);
      if (point) select(point);
    }
  };
  const viewer = derivation ? (
    <PointCloudViewer
      ref={viewerRef}
      data={derivation.cloud}
      view={view}
      selected={selected}
      onSelect={select}
      trajectory={
        mode === "trajectory" && path && render
          ? { path, frame: trajectoryFrame, fps: render.fps }
          : null
      }
    />
  ) : (
    <section className="panel empty-state">
      <LayoutGrid size={32} />
      <h2>从一对 RGB-D 数据开始</h2>
      <p>确认深度语义与几何关系后，生成可复现的点云、测量和轨迹。</p>
    </section>
  );
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">RD</div>
          <div>
            <strong>RGB-D Lab</strong>
            <span>PRIVATE ANALYSIS WORKBENCH</span>
          </div>
        </div>
        <div className="topbar-context">
          <span className="context-dot" />
          <span>{scene?.name ?? "未选择 Scene"}</span>
          <span className="readonly-chip">
            <LockKeyhole size={12} />
            浏览器本地
          </span>
        </div>
        <button
          className="secondary"
          type="button"
          disabled={!scene}
          onClick={() => void archive(workbench)}
        >
          <Download size={15} />
          导出 Archive
        </button>
      </header>
      <div className="workbench-layout">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>SCENE LIBRARY</span>
            <Plus size={15} />
          </div>
          <div className="scene-list">
            {scenes.map((item) => (
              <button
                key={item.sceneId}
                className={scene?.sceneId === item.sceneId ? "scene-card active" : "scene-card"}
                type="button"
                onClick={() => choose(item, workbench)}
              >
                <Database size={15} />
                <span>
                  {item.name}
                  <small>
                    {item.geometry.depth.representation} · {item.geometry.depth.unit}
                  </small>
                </span>
              </button>
            ))}
            {!scenes.length && <p className="sidebar-empty">还没有 Scene</p>}
          </div>
          <div className="sidebar-section-label">工作模式</div>
          <nav className="mode-nav" aria-label="工作模式">
            {(
              [
                {
                  id: "inspect",
                  label: "检查与测量",
                  detail: "输入 · 点云 · 测量",
                  icon: LayoutGrid,
                },
                {
                  id: "compare",
                  label: "四视图对照",
                  detail: "RGB / 深度 / 3D / 统计",
                  icon: Settings2,
                },
                {
                  id: "trajectory",
                  label: "轨迹与导出",
                  detail: "关键帧 · 预览 · 视频",
                  icon: Route,
                },
              ] as const
            ).map(({ id, label, detail, icon: Icon }) => (
              <button
                type="button"
                key={id}
                className={mode === id ? "active" : ""}
                onClick={() => setMode(id)}
              >
                <Icon size={16} />
                <span>
                  {label}
                  <small>{detail}</small>
                </span>
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span className="status-light" />
            M3 · 浏览器工作台
          </div>
        </aside>
        <main className="main-content">
          <ImportPanel workbench={workbench} />
          {scene && (
            <section className="scene-heading">
              <div>
                <span className="eyebrow">ACTIVE SCENE</span>
                <h1>{scene.name}</h1>
              </div>
              <button
                className="icon-button"
                aria-label="删除 Scene"
                title="删除 Scene"
                type="button"
                onClick={() => {
                  if (window.confirm("删除当前 Scene 及其派生缓存？请先导出 Archive 备份。"))
                    void remove(workbench);
                }}
              >
                <Trash2 size={17} />
              </button>
            </section>
          )}
          {scene && previews && (
            <SourcePreviews
              rgb={previews.rgb}
              depth={previews.depthPreview}
              width={scene.sources.rgb.width!}
              height={scene.sources.rgb.height!}
              unit={scene.geometry.depth.unit}
            />
          )}
          {scene && <ProcessingPanel workbench={workbench} />}
          {mode !== "trajectory" && derivation && (
            <section className="panel pointcloud-panel">
              <div className="panel-heading">
                <h2>{mode === "compare" ? "RGB / 深度 / 点云 / 统计" : "点云与测量"}</h2>
                <ViewControls />
              </div>
              {mode === "compare" && previews && (
                <SourcePreviews
                  rgb={previews.rgb}
                  depth={previews.depthPreview}
                  width={scene!.sources.rgb.width!}
                  height={scene!.sources.rgb.height!}
                  unit={scene!.geometry.depth.unit}
                  selected={selected}
                  onPixelSelected={selectPixel}
                />
              )}
              {viewer}
              <div className="analysis-bottom">
                {mode === "compare" && (
                  <StatisticsPanel depth={previews?.depth ?? null} cloud={derivation.cloud} />
                )}
                <MeasurementPanel />
                <ExportActions viewerRef={viewerRef} />
              </div>
            </section>
          )}
          {mode !== "trajectory" && !derivation && viewer}
          {mode === "trajectory" && (
            <>
              <section className="panel pointcloud-panel">
                <div className="panel-heading">
                  <h2>轨迹预览</h2>
                  <ViewControls />
                </div>
                {viewer}
              </section>
              <TrajectoryPanel workbench={workbench} viewerRef={viewerRef} />
            </>
          )}
        </main>
        <aside className="right-rail">
          <div className="rail-heading">
            <span className="eyebrow">SCENE CONTRACT</span>
            <h2>可信度检查</h2>
          </div>
          {scene && capabilities ? (
            <div className="contract-list">
              <Contract label="二维检查" ok={capabilities.image_inspection} value="本地解码" />
              <Contract
                label="尺寸一致"
                ok={
                  scene.sources.rgb.width === scene.sources.depth.width &&
                  scene.sources.rgb.height === scene.sources.depth.height
                }
                value={`${scene.sources.rgb.width} × ${scene.sources.rgb.height}`}
              />
              <Contract label="深度语义" ok value={scene.geometry.depth.representation} />
              <Contract label="单位" ok value={scene.geometry.depth.unit} />
              <Contract
                label="米制几何"
                ok={capabilities.metric_pointcloud}
                value={capabilities.metric_pointcloud ? "可用" : "未启用"}
              />
              <Contract
                label="Applied 派生"
                ok={derivation !== null}
                value={
                  derivation ? `${derivation.manifest.pointCount.toLocaleString()} 点` : "尚未应用"
                }
              />
            </div>
          ) : (
            <p className="rail-empty">导入后显示 Scene 合同和能力门禁。</p>
          )}
          <div className="rail-note">
            <strong>数据边界</strong>
            <p>
              源文件不上传、不修改。几何与视频在同一 Worker 中确定性生成。IndexedDB
              保存浏览器内工作区。
            </p>
          </div>
        </aside>
      </div>
      <footer className="statusbar">
        <span>
          <i className="status-light" />
          {busy ?? "源数据只读 · 派生结果可重建"}
        </span>
        <span>
          {derivation
            ? `${derivation.manifest.derivationKey.slice(0, 12)} · APPLIED`
            : "RGB-D LAB / BROWSER"}
        </span>
      </footer>
      {error && !useWorkbench.getState().preparation && (
        <div className="toast-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
function Contract({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}): React.JSX.Element {
  return (
    <div className="contract-row">
      <span>{label}</span>
      <strong className={ok ? "ok" : "pending"}>
        {ok ? "✓" : "—"} {value}
      </strong>
    </div>
  );
}
