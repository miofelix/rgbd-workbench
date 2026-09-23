import { Database, Download, LayoutGrid, LockKeyhole, Plus, RefreshCw, Route, Settings2 } from "lucide-react";
import { useEffect } from "react";

import { ImportWizard } from "../features/import/ImportWizard";
import { SceneInspector } from "../features/inspect/SceneInspector";
import { useWorkbenchStore } from "../state/workbench";

export function App(): React.JSX.Element {
  const {
    activeMode,
    activeSceneId,
    appliedScene,
    scenes,
    loadScenes,
    selectScene,
    setMode,
    setImportSession,
  } = useWorkbenchStore();

  useEffect(() => {
    void loadScenes();
  }, [loadScenes]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">RD</div>
          <div><strong>RGB-D Lab</strong><span>UNIVERSAL ANALYSIS WORKBENCH</span></div>
        </div>
        <div className="topbar-context">
          <span className="context-dot" />
          <span>{appliedScene?.display_name ?? "未选择 Scene"}</span>
          <span className="readonly-chip"><LockKeyhole size={12} /> 本地只读</span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="icon-button" title="刷新 Scene" aria-label="刷新 Scene" onClick={() => void loadScenes()}><RefreshCw size={17} /></button>
          <button type="button" className="secondary top-action" disabled><Download size={15} /> 导出</button>
        </div>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <div className="sidebar-title"><span>SCENES</span><button type="button" className="icon-button small" title="添加 Scene" aria-label="添加 Scene"><Plus size={15} /></button></div>
          <div className="scene-list">
            {scenes.map((scene) => (
              <button
                type="button"
                className={`scene-row ${scene.scene_id === activeSceneId ? "active" : ""}`}
                key={scene.scene_id}
                onClick={() => selectScene(scene)}
              >
                <span className="scene-row-icon"><Database size={15} /></span>
                <span><strong>{scene.display_name}</strong><small>{scene.rgb.width ?? "—"} × {scene.rgb.height ?? "—"} · {scene.depth_spec?.unit ?? "未确认"}</small></span>
              </button>
            ))}
            {scenes.length === 0 && <p className="sidebar-empty">还没有 Scene</p>}
          </div>
          <div className="sidebar-section-label">工作模式</div>
          <nav className="mode-nav" aria-label="工作模式">
            <button type="button" className={activeMode === "inspect" ? "active" : ""} onClick={() => setMode("inspect")}><LayoutGrid size={16} /><span>检查与测量<small>二维输入 · 统计 · 状态</small></span></button>
            <button type="button" className={activeMode === "compare" ? "active" : ""} onClick={() => setMode("compare")}><Settings2 size={16} /><span>四视图对照<small>RGB / 深度 / 3D / 统计</small></span></button>
            <button type="button" className={activeMode === "trajectory" ? "active" : ""} onClick={() => setMode("trajectory")}><Route size={16} /><span>轨迹与导出<small>预设 · 关键帧 · 视频</small></span></button>
          </nav>
          <div className="sidebar-footer"><span className="status-light" /> M1 · 输入与诊断</div>
        </aside>
        <main className="main-content">
          <ImportWizard onProbed={setImportSession} onCommitted={(scene) => {
            selectScene(scene);
            void loadScenes();
          }} />
          <SceneInspector scene={appliedScene} mode={activeMode} />
        </main>
        <aside className="right-rail">
          <div className="rail-heading"><span className="eyebrow">SCENE CONTRACT</span><h2>可信度检查</h2></div>
          {appliedScene ? (
            <div className="contract-list">
              <ContractRow label="RGB / 深度尺寸" ok={appliedScene.rgb.width === appliedScene.depth.width && appliedScene.rgb.height === appliedScene.depth.height} value={`${appliedScene.rgb.width ?? "—"} × ${appliedScene.rgb.height ?? "—"}`} />
              <ContractRow label="深度语义" ok={Boolean(appliedScene.depth_spec)} value={appliedScene.depth_spec?.representation ?? "未确认"} />
              <ContractRow label="单位" ok={Boolean(appliedScene.depth_spec?.unit)} value={appliedScene.depth_spec?.unit ?? "未确认"} />
              <ContractRow label="相机内参" ok={Boolean(appliedScene.camera)} value={appliedScene.camera ? "已提供" : "待补全"} />
              <ContractRow label="对齐状态" ok={appliedScene.alignment?.state === "registered_to_rgb"} value={appliedScene.alignment?.state ?? "未确认"} />
            </div>
          ) : (
            <div className="rail-empty"><LockKeyhole size={19} /><p>导入后显示 Scene 合同和能力门禁。</p></div>
          )}
          <div className="rail-note"><strong>数据边界</strong><p>源文件不被修改。单位、内参和对齐关系不会从机器配置猜测。</p></div>
        </aside>
      </div>
      <footer className="statusbar"><span><i className="status-light" /> 源数据只读 · 派生结果可重建</span><span>RGB-D LAB / LOCAL SESSION</span></footer>
    </div>
  );
}

function ContractRow({ label, value, ok }: { label: string; value: string; ok: boolean }): React.JSX.Element {
  return <div className="contract-row"><span>{label}</span><strong className={ok ? "ok" : "pending"}>{ok ? "✓" : "—"} {value}</strong></div>;
}
