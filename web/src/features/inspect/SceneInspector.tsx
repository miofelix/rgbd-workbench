import { Crosshair, Ruler, ScanLine } from "lucide-react";

import { scenePreviewUrl } from "../../api/client";
import type { SceneSummary } from "../../api/types";
import { DepthPreview } from "./DepthPreview";
import { StatisticsPanel } from "./StatisticsPanel";

interface SceneInspectorProps {
  scene: SceneSummary | null;
  mode: "inspect" | "compare" | "trajectory";
}

export function SceneInspector({ scene, mode }: SceneInspectorProps): React.JSX.Element {
  if (!scene) {
    return (
      <section className="empty-workspace">
        <div className="empty-icon"><ScanLine size={28} /></div>
        <span className="eyebrow">READY WHEN YOU ARE</span>
        <h2>从一组 RGB-D 开始</h2>
        <p>导入后，先检查二维数据与深度语义，再逐步解锁点云和轨迹能力。</p>
      </section>
    );
  }
  const metric = scene.capabilities?.metric_pointcloud ?? Boolean(scene.depth_spec?.unit === "m" || scene.depth_spec?.unit === "mm");
  return (
    <div className="scene-inspector">
      <div className="scene-toolbar">
        <div>
          <span className="eyebrow">SCENE INSPECTOR</span>
          <h2>{scene.display_name}</h2>
        </div>
        <span className={`capability-pill ${metric ? "ready" : "pending"}`}>
          {metric ? "米制几何可用" : scene.depth_spec?.unit === "unitless" ? "相对深度" : "待补全"}
        </span>
      </div>
      {mode === "inspect" && (
        <>
          <div className="source-previews">
            <div className="preview-frame rgb-preview">
              <img src={scenePreviewUrl(scene.scene_id, "rgb")} alt="RGB 图像" />
              <span className="preview-label">RGB · {scene.rgb.width} × {scene.rgb.height}</span>
            </div>
            <DepthPreview src={scenePreviewUrl(scene.scene_id, "depth")} label={`DEPTH · ${scene.depth_spec?.unit ?? "未确认"}`} />
          </div>
          <div className="inspection-grid">
            <section className="panel compact-panel">
              <div className="panel-heading"><h3>查看状态</h3><Crosshair size={17} /></div>
              <div className="status-rows">
                <div><span>坐标基准</span><strong>{scene.frame_id} frame</strong></div>
                <div><span>深度表示</span><strong>{scene.depth_spec?.representation ?? "未确认"}</strong></div>
                <div><span>对齐</span><strong>{scene.alignment?.state ?? "未确认"}</strong></div>
                <div><span>源文件</span><strong>只读</strong></div>
              </div>
            </section>
            <section className="panel compact-panel disabled-panel">
              <div className="panel-heading"><h3>三维能力</h3><Ruler size={17} /></div>
              <p>{metric ? "点云将在 M2 工作区中解锁。" : "补全单位、内参和对齐后解锁。"}</p>
              <button type="button" disabled>查看点云 · M2</button>
            </section>
          </div>
          <section className="panel statistics-panel">
            <div className="panel-heading"><h3>深度摘要</h3><span className="muted">当前输入</span></div>
            <StatisticsPanel scene={scene} />
          </section>
        </>
      )}
      {mode !== "inspect" && (
        <section className="mode-placeholder panel">
          <span className="eyebrow">M1 CAPABILITY GATE</span>
          <h3>{mode === "compare" ? "四视图对照" : "轨迹与导出"}</h3>
          <p>{mode === "compare" ? "对照模式会在点云处理完成后启用。当前仍可在检查模式核对输入。" : "轨迹编辑与视频导出属于 M3，将复用当前 Scene 合同。"}</p>
          <span className="coming-pill">即将解锁</span>
        </section>
      )}
    </div>
  );
}
