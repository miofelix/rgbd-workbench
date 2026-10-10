import {
  Database,
  Download,
  LayoutGrid,
  LoaderCircle,
  Plus,
  RefreshCw,
  Route,
  Settings2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ImportWizard } from "../features/import/ImportWizard";
import { SceneInspector } from "../features/inspect/SceneInspector";
import { useWorkbenchStore } from "../state/workbench";

export function App(): React.JSX.Element {
  const {
    activeMode,
    activeSceneId,
    appliedDerivation,
    appliedScene,
    scenes,
    scenesLoading,
    scenesError,
    loadScenes,
    selectScene,
    setMode,
    setImportSession,
  } = useWorkbenchStore();
  const [initialImportId, setInitialImportId] = useState(
    () =>
      new URLSearchParams(window.location.search).get("import") ?? undefined,
  );
  const [importOpen, setImportOpen] = useState(Boolean(initialImportId));
  const [importRevision, setImportRevision] = useState(0);
  const importContainer = useRef<HTMLDivElement>(null);
  const showImport = importOpen || (!appliedScene && !scenesLoading);

  useEffect(() => {
    void loadScenes();
  }, [loadScenes]);
  useEffect(() => {
    if (showImport)
      importContainer.current
        ?.querySelector<HTMLInputElement>("input")
        ?.focus();
  }, [showImport, importRevision]);

  const closeImport = (): void => {
    setImportOpen(false);
    setInitialImportId(undefined);
    const url = new URL(window.location.href);
    url.searchParams.delete("import");
    window.history.replaceState(null, "", url);
  };
  const openImport = (): void => {
    setImportOpen(true);
    setImportRevision((value) => value + 1);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">
        跳到工作区
      </a>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            RD
          </div>
          <div>
            <strong>RGB-D Lab</strong>
            <span>本地 RGB-D 工作台</span>
          </div>
        </div>
        <div className="topbar-context">
          <span className="context-dot" />
          <span>{appliedScene?.display_name ?? "从一组图像开始"}</span>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="secondary top-action"
            disabled={!appliedDerivation}
            onClick={() => {
              const exports = document.getElementById("static-exports");
              exports?.scrollIntoView({ behavior: "smooth", block: "center" });
              exports
                ?.querySelector<HTMLAnchorElement>("a")
                ?.focus({ preventScroll: true });
            }}
          >
            <Download size={16} /> 导出
          </button>
          <button type="button" className="primary" onClick={openImport}>
            <Plus size={17} /> 导入
          </button>
        </div>
      </header>
      <div className="app-body">
        <aside className="sidebar" aria-label="场景与模式">
          <div className="sidebar-title">
            <span>
              场景 <span className="scene-count">{scenes.length}</span>
            </span>
            <div className="sidebar-actions">
              <button
                type="button"
                className="icon-button small"
                title="刷新场景"
                aria-label="刷新 Scene"
                disabled={scenesLoading}
                onClick={() => void loadScenes()}
              >
                {scenesLoading ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <RefreshCw size={16} />
                )}
              </button>
              <button
                type="button"
                className="icon-button small"
                title="添加场景"
                aria-label="添加 Scene"
                onClick={openImport}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          {scenesError && (
            <div className="scene-error" role="alert">
              <p>{scenesError}</p>
              <button
                className="secondary"
                type="button"
                onClick={() => void loadScenes()}
              >
                重试
              </button>
            </div>
          )}
          <label className="mobile-scene-picker">
            当前场景
            <select
              aria-label="当前场景"
              value={activeSceneId ?? ""}
              disabled={scenes.length === 0}
              onChange={(event) => {
                const scene = scenes.find(
                  (item) => item.scene_id === event.target.value,
                );
                if (scene) {
                  selectScene(scene);
                  closeImport();
                }
              }}
            >
              {scenes.length === 0 && <option value="">还没有场景</option>}
              {scenes.map((scene) => (
                <option key={scene.scene_id} value={scene.scene_id}>
                  {scene.display_name}
                </option>
              ))}
            </select>
          </label>
          <div className="scene-list">
            {scenes.map((scene) => (
              <button
                type="button"
                className={`scene-row ${scene.scene_id === activeSceneId ? "active" : ""}`}
                aria-current={
                  scene.scene_id === activeSceneId ? "true" : undefined
                }
                key={scene.scene_id}
                onClick={() => {
                  selectScene(scene);
                  closeImport();
                }}
              >
                <span className="scene-row-icon">
                  <Database size={17} />
                </span>
                <span className="scene-row-text">
                  <strong title={scene.display_name}>
                    {scene.display_name}
                  </strong>
                  <small>
                    {scene.rgb.width ?? "—"} × {scene.rgb.height ?? "—"} ·{" "}
                    {scene.depth_spec?.unit ?? "未确认单位"}
                  </small>
                </span>
              </button>
            ))}
            {!scenesLoading && scenes.length === 0 && (
              <p className="sidebar-empty">导入图像后，场景会保存在这里。</p>
            )}
          </div>
          <div className="sidebar-section-label">工作模式</div>
          <nav className="mode-nav" aria-label="工作模式">
            <button
              type="button"
              className={activeMode === "inspect" ? "active" : ""}
              aria-current={activeMode === "inspect" ? "page" : undefined}
              onClick={() => setMode("inspect")}
            >
              <LayoutGrid size={18} />
              <span>
                检查与测量<small>查看输入与三维点云</small>
              </span>
            </button>
            <button
              type="button"
              className={activeMode === "compare" ? "active" : ""}
              aria-current={activeMode === "compare" ? "page" : undefined}
              disabled={!appliedScene}
              onClick={() => setMode("compare")}
            >
              <Settings2 size={18} />
              <span>
                四视图对照<small>图像、点云与统计联动</small>
              </span>
            </button>
            <button
              type="button"
              className={activeMode === "trajectory" ? "active" : ""}
              aria-current={activeMode === "trajectory" ? "page" : undefined}
              disabled={!appliedScene}
              onClick={() => setMode("trajectory")}
            >
              <Route size={18} />
              <span>
                轨迹预览<small>选择预设与播放视角</small>
              </span>
            </button>
          </nav>
          <div className="sidebar-footer">
            <span className="status-light" /> 本地处理 · 源文件只读
          </div>
        </aside>
        <main id="workspace" className="main-content" tabIndex={-1}>
          {scenesLoading && !appliedScene && !importOpen && (
            <p className="inline-status" role="status">
              <LoaderCircle className="spin" size={18} /> 正在读取场景…
            </p>
          )}
          {showImport ? (
            <div className="import-workspace" ref={importContainer}>
              {appliedScene && (
                <button
                  type="button"
                  className="secondary cancel-import"
                  onClick={closeImport}
                >
                  返回当前场景
                </button>
              )}
              <ImportWizard
                key={importRevision}
                initialImportId={initialImportId}
                activeSceneId={activeSceneId}
                onProbed={setImportSession}
                onCommitted={(scene) => {
                  selectScene(scene);
                  setMode("inspect");
                  closeImport();
                  void loadScenes();
                }}
              />
              {!appliedScene && (
                <p className="welcome-note">
                  选择 RGB
                  图像与深度文件，确认单位后开始检查。所有数据都在本机处理。
                </p>
              )}
            </div>
          ) : (
            <SceneInspector scene={appliedScene} mode={activeMode} />
          )}
        </main>
      </div>
      <footer className="statusbar">
        <span>
          <i className="status-light" /> 源文件只读
        </span>
        <span>
          {appliedDerivation
            ? `${appliedDerivation.point_count.toLocaleString()} 点 · ${appliedDerivation.unit}`
            : "本地工作区"}
        </span>
      </footer>
    </div>
  );
}
