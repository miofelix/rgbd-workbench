import { useEffect, useMemo, useState, type RefObject } from "react";
import type { ViewerHandle } from "@/features/pointcloud/PointCloudViewer";
import { KeyframeEditor, snapshotKeyframe } from "./KeyframeEditor";
import { trajectoryWarnings } from "@/compute/trajectory/validation";
import { Download, Pause, Play, Route } from "lucide-react";
import type { Workbench } from "@/application/workbench";
import { useWorkbench } from "@/app/state";
import {
  cameraPathSchema,
  renderSpecSchema,
  type CameraPath,
  type RenderSpec,
} from "@/domain/trajectory";
import { defaultCameraPath, frameCount, medianTarget } from "@/compute/trajectory/path";
import type { VideoCapability } from "@/compute/render/video-capabilities";

function initialRender(): RenderSpec {
  return renderSpecSchema.parse({
    format: "rgbd-workbench/render-spec",
    schemaVersion: 2,
    layout: "pointcloud",
    width: 1280,
    height: 720,
    fps: 30,
    codec: "avc",
    quality: "high",
    background: "dark",
    pointSize: 2,
    antiAlias: 1,
    colorMode: "rgb",
    colorMap: "turbo",
    colorRange: { min: 0, max: 1 },
    maxPoints: 150_000,
    overlays: { axes: false, grid: false, title: false, unit: true, time: false, provenance: true },
  });
}
function renderIsValid(render: RenderSpec): boolean {
  return renderSpecSchema.safeParse(render).success;
}
export function TrajectoryPanel({
  workbench,
  viewerRef,
}: {
  workbench: Workbench;
  viewerRef: RefObject<ViewerHandle | null>;
}): React.JSX.Element {
  const {
    derivation,
    path,
    render,
    trajectoryFrame,
    playing,
    busy,
    progress,
    setTrajectory,
    setTrajectoryFrame,
    setPlaying,
    exportVideo,
    cancel,
    selected,
    exportJob,
    error,
  } = useWorkbench();
  const [draftPath, setDraftPath] = useState<CameraPath | null>(null);
  const [targetMode, setTargetMode] = useState<
    "scene_median" | "roi_median" | "selected_point" | "manual"
  >("scene_median");
  const [validation, setValidation] = useState<string | null>(null);
  const [kind, setKind] = useState<CameraPath["kind"]>("orbit");
  const [duration, setDuration] = useState(5);
  const [radiusScale, setRadiusScale] = useState(1.5);
  const [elevation, setElevation] = useState(20);
  const [loopMode, setLoopMode] = useState<CameraPath["loopMode"]>("loop");
  const [easing, setEasing] = useState<CameraPath["easing"]>("linear");
  const [turns, setTurns] = useState(1);
  const [settings, setSettings] = useState<RenderSpec>(initialRender);
  const [capabilities, setCapabilities] = useState<VideoCapability[]>([]);
  const target = useMemo(() => {
    if (!derivation) return null;
    if (targetMode === "selected_point" && selected[0]) return selected[0].position;
    if (targetMode === "roi_median" && derivation.manifest.processing.roi) {
      const [x0, y0, x1, y1] = derivation.manifest.processing.roi;
      const [, width] = derivation.manifest.sourceShape;
      const indices = Array.from({ length: derivation.manifest.pointCount }, (_, i) => i).filter(
        (i) => {
          const pixel = derivation.cloud.sourcePixelIndex[i]!;
          const x = pixel % width;
          const y = Math.floor(pixel / width);
          return x >= x0 && x < x1 && y >= y0 && y < y1;
        },
      );
      if (indices.length === 0) return null;
      const positions = new Float32Array(indices.length * 3);
      indices.forEach((index, i) =>
        positions.set(derivation.cloud.positions.subarray(index * 3, index * 3 + 3), i * 3),
      );
      return medianTarget(positions);
    }
    return medianTarget(derivation.cloud.positions);
  }, [derivation, targetMode, selected]);
  const diagonal = derivation
    ? Math.hypot(
        ...derivation.manifest.bounds.max.map((v, i) => v - derivation.manifest.bounds.min[i]!),
      )
    : 1;
  const createPath = (): CameraPath =>
    cameraPathSchema.parse({
      ...defaultCameraPath(target ?? [0, 0, 1], Math.max(diagonal * radiusScale, 0.1)),
      kind,
      duration,
      elevation,
      loopMode,
      easing,
      turns,
      unit: derivation?.manifest.unit ?? "m",
      frameId: derivation?.manifest.frameId ?? "camera",
      targetSource: {
        kind: targetMode,
        pixelIndex: targetMode === "selected_point" ? (selected[0]?.pixelIndex ?? null) : null,
      },
    });
  useEffect(() => {
    if (derivation && !path) {
      const next = createPath();
      setTrajectory(next, settings);
      setDraftPath(next);
    }
  }, [derivation]);
  useEffect(() => {
    if (renderIsValid(settings))
      void import("@/compute/render/video-capabilities")
        .then(({ probeVideoCodecs }) => probeVideoCodecs(settings))
        .then(setCapabilities);
    else setCapabilities([]);
  }, [settings]);
  useEffect(() => {
    if (!playing || !path || !render) return;
    const count = frameCount(path, render.fps);
    const timer = window.setInterval(
      () => setTrajectoryFrame((useWorkbench.getState().trajectoryFrame + 1) % count),
      1000 / render.fps,
    );
    return () => window.clearInterval(timer);
  }, [playing, path, render, setTrajectoryFrame]);
  const updatePath = (): void => {
    try {
      const next = draftPath
        ? cameraPathSchema.parse({
            ...draftPath,
            duration,
            loopMode,
            target: target ?? draftPath.target,
            targetSource: {
              kind: targetMode,
              pixelIndex:
                targetMode === "selected_point" ? (selected[0]?.pixelIndex ?? null) : null,
            },
          })
        : createPath();
      const warnings = trajectoryWarnings(next, settings.fps);
      if (warnings.length) {
        setValidation(warnings.join(" "));
        return;
      }
      setValidation(null);
      setTrajectory(next, settings);
      setDraftPath(next);
    } catch (cause) {
      setValidation(cause instanceof Error ? cause.message : "轨迹合同无效");
    }
  };
  const patchRender = (patch: Partial<RenderSpec>): void => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (path) setTrajectory(path, next);
  };
  const updateKeyframes = (): void => {
    if (!path || !target) return;
    const start = path.keyframes[0] ?? {
      time: 0,
      position: [target[0] + diagonal, target[1], target[2] + diagonal] as [number, number, number],
      target,
      up: [0, -1, 0] as [number, number, number],
      projection: "perspective" as const,
      fov: 45,
      orthoScale: diagonal,
      easing: "smoothstep" as const,
    };
    const end = {
      ...start,
      time: duration,
      position: [target[0] - diagonal, target[1] - diagonal * 0.25, target[2] + diagonal] as [
        number,
        number,
        number,
      ],
    };
    setTrajectory(
      { ...path, kind: "custom", duration, loopMode: "once", keyframes: [start, end] },
      settings,
    );
  };
  if (!derivation)
    return (
      <section className="panel empty-state">
        <Route size={30} />
        <h2>先应用点云处理</h2>
        <p>轨迹使用当前 Applied Derivation，未应用的草稿不会改变视频几何。</p>
      </section>
    );
  const activePath = path ?? draftPath ?? createPath();
  const count =
    activePath.duration * settings.fps >= 2 && activePath.duration * settings.fps <= 7200
      ? frameCount(activePath, settings.fps)
      : 2;
  return (
    <div className="trajectory-layout">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CAMERA PATH</span>
            <h3>轨迹与关键帧</h3>
          </div>
          <Route size={18} />
        </div>
        <div className="form-grid two">
          <label>
            轨迹预设
            <select
              aria-label="轨迹预设"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as CameraPath["kind"]);
              }}
            >
              <option value="orbit">环绕</option>
              <option value="ellipse">椭圆环绕</option>
              <option value="dolly">推近 / 拉远</option>
              <option value="truck">横移</option>
              <option value="pedestal">升降</option>
              <option value="tilt_pan">俯仰 / 摇摄</option>
              <option value="spiral">螺旋</option>
              <option value="flythrough">飞越</option>
              <option value="dolly_zoom">Dolly Zoom</option>
            </select>
          </label>
          <label>
            时长 (秒)
            <input
              aria-label="轨迹时长"
              type="number"
              min="0.1"
              max="120"
              step="0.5"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </label>
          <label>
            半径 / 场景尺度
            <input
              aria-label="轨迹半径"
              type="number"
              min="0.1"
              step="0.1"
              value={radiusScale}
              onChange={(e) => setRadiusScale(Number(e.target.value))}
            />
          </label>
          <label>
            仰角
            <input
              aria-label="轨迹仰角"
              type="number"
              min="-89"
              max="89"
              value={elevation}
              onChange={(e) => setElevation(Number(e.target.value))}
            />
          </label>
          <label>
            圈数
            <input
              aria-label="轨迹圈数"
              type="number"
              min="0.01"
              step="0.25"
              value={turns}
              onChange={(e) => setTurns(Number(e.target.value))}
            />
          </label>
          <label>
            循环方式
            <select
              aria-label="循环方式"
              value={loopMode}
              onChange={(e) => setLoopMode(e.target.value as CameraPath["loopMode"])}
            >
              <option value="loop">loop · 不重复端点</option>
              <option value="once">once · 包含首尾</option>
            </select>
          </label>
          <label>
            缓动
            <select
              aria-label="轨迹缓动"
              value={easing}
              onChange={(e) => setEasing(e.target.value as CameraPath["easing"])}
            >
              <option value="linear">linear</option>
              <option value="smoothstep">smoothstep</option>
              <option value="ease_in_out_cubic">ease_in_out_cubic</option>
            </select>
          </label>
        </div>
        <div className="button-row">
          <button type="button" className="primary" onClick={updatePath}>
            应用轨迹
          </button>
          <button type="button" className="secondary" onClick={updateKeyframes}>
            使用两点关键帧
          </button>
        </div>
        <p className="field-note">
          target 为当前点云逐轴中位数。自定义关键帧采用 centripetal
          Catmull–Rom；预览与导出共用采样器。
        </p>
        <label>
          Target 来源
          <select
            aria-label="Target 来源"
            value={targetMode}
            onChange={(e) => setTargetMode(e.target.value as typeof targetMode)}
          >
            <option value="scene_median">场景稳健中心</option>
            <option value="roi_median">ROI 中心</option>
            <option value="selected_point">选中点</option>
            <option value="manual">手工 XYZ</option>
          </select>
        </label>
        {targetMode === "manual" && (
          <div className="form-grid three">
            {(target ?? [0, 0, 0]).map((value, axis) => (
              <label key={axis}>
                {"XYZ"[axis]}
                <input
                  aria-label={`Target ${"xyz"[axis]}`}
                  type="number"
                  step="any"
                  value={value}
                  onChange={(e) => {
                    const next = [...(target ?? [0, 0, 0])] as [number, number, number];
                    next[axis] = Number(e.target.value);
                    setDraftPath({ ...(draftPath ?? createPath()), target: next });
                  }}
                />
              </label>
            ))}
          </div>
        )}
        <KeyframeEditor
          path={draftPath ?? activePath}
          onChange={setDraftPath}
          onAdd={() => {
            const snapshot = viewerRef.current?.cameraSnapshot();
            if (!snapshot) {
              setValidation("当前轨迹相机不能添加为自由视角，请退出播放后调整视角。");
              return;
            }
            const base = draftPath ?? activePath;
            const keyframe = snapshotKeyframe(
              snapshot,
              base.keyframes.length
                ? Math.min(base.duration, base.keyframes.at(-1)!.time + base.duration / 4)
                : 0,
            );
            const frames = [...base.keyframes, keyframe].sort((a, b) => a.time - b.time);
            if (frames.length === 2) frames[1]!.time = base.duration;
            setDraftPath({ ...base, kind: "custom", keyframes: frames });
          }}
        />
        {validation && (
          <p className="error-message" role="alert">
            {validation}
          </p>
        )}
        <div className="timeline">
          <button
            className="icon-button"
            aria-label={playing ? "暂停轨迹" : "播放轨迹"}
            type="button"
            onClick={() => setPlaying(!playing)}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>
          <input
            aria-label="轨迹时间轴"
            type="range"
            min="0"
            max={count - 1}
            value={Math.min(trajectoryFrame, count - 1)}
            onChange={(e) => {
              setPlaying(false);
              setTrajectoryFrame(Number(e.target.value));
            }}
          />
          <span>
            {(trajectoryFrame / settings.fps).toFixed(2)}s / {activePath.duration.toFixed(2)}s
          </span>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">DETERMINISTIC RENDER</span>
            <h3>视频导出</h3>
          </div>
          <Download size={18} />
        </div>
        <div className="form-grid three">
          <label>
            版式
            <select
              aria-label="视频版式"
              value={settings.layout}
              onChange={(e) => patchRender({ layout: e.target.value as RenderSpec["layout"] })}
            >
              <option value="pointcloud">纯三维</option>
              <option value="rgb_depth_pointcloud">RGB / 深度 / 三维</option>
            </select>
          </label>
          <label>
            宽度
            <input
              aria-label="视频宽度"
              type="number"
              step="2"
              min="2"
              max="4096"
              value={settings.width}
              onChange={(e) => patchRender({ width: Number(e.target.value) })}
            />
          </label>
          <label>
            高度
            <input
              aria-label="视频高度"
              type="number"
              step="2"
              min="2"
              max="4096"
              value={settings.height}
              onChange={(e) => patchRender({ height: Number(e.target.value) })}
            />
          </label>
          <label>
            FPS
            <input
              aria-label="视频 FPS"
              type="number"
              min="1"
              max="60"
              value={settings.fps}
              onChange={(e) => patchRender({ fps: Number(e.target.value) })}
            />
          </label>
          <label>
            编码
            <select
              aria-label="视频编码"
              value={settings.codec}
              onChange={(e) => patchRender({ codec: e.target.value as RenderSpec["codec"] })}
            >
              <option value="avc">MP4 · H.264</option>
              <option value="vp9">WebM · VP9</option>
              <option value="png">PNG 帧序列</option>
            </select>
          </label>
          <label>
            质量
            <select
              aria-label="视频质量"
              value={settings.quality}
              onChange={(e) => patchRender({ quality: e.target.value as RenderSpec["quality"] })}
            >
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>
          <label>
            抗锯齿
            <select
              aria-label="抗锯齿"
              value={settings.antiAlias}
              onChange={(e) => patchRender({ antiAlias: Number(e.target.value) as 1 | 2 })}
            >
              <option value="1">1x</option>
              <option value="2">2x</option>
            </select>
          </label>
          <label>
            色图
            <select
              aria-label="视频色图"
              value={settings.colorMap}
              onChange={(e) => patchRender({ colorMap: e.target.value as RenderSpec["colorMap"] })}
            >
              <option value="turbo">Turbo</option>
              <option value="viridis">Viridis</option>
              <option value="inferno">Inferno</option>
              <option value="magma">Magma</option>
              <option value="plasma">Plasma</option>
              <option value="cividis">Cividis</option>
              <option value="gray">Gray</option>
            </select>
          </label>
          <label>
            色标最小值
            <input
              aria-label="色标最小值"
              type="number"
              step="any"
              value={settings.colorRange.min}
              onChange={(e) =>
                patchRender({ colorRange: { ...settings.colorRange, min: Number(e.target.value) } })
              }
            />
          </label>
          <label>
            色标最大值
            <input
              aria-label="色标最大值"
              type="number"
              step="any"
              value={settings.colorRange.max}
              onChange={(e) =>
                patchRender({ colorRange: { ...settings.colorRange, max: Number(e.target.value) } })
              }
            />
          </label>
          <label>
            渲染点数上限
            <input
              aria-label="渲染点数上限"
              type="number"
              min="1"
              max="2000000"
              step="1000"
              value={settings.maxPoints}
              onChange={(e) => patchRender({ maxPoints: Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="codec-status">
          {settings.codec === "png"
            ? "PNG 序列不需要浏览器视频编码器；在导出中心下载 ZIP。"
            : capabilities.find((c) => c.codec === settings.codec)?.available
              ? "当前浏览器支持所选编码"
              : "当前浏览器未确认支持所选编码，可切换格式或 PNG 序列"}
        </p>
        {error && (
          <p className="error-message" role="alert" data-testid="export-error">
            {error}
          </p>
        )}
        <p className="job-status">
          {exportJob
            ? `任务 ${exportJob.jobId.slice(0, 8)} · ${exportJob.status} · ${Math.round(exportJob.progress * 100)}%`
            : "尚未创建导出任务"}
        </p>
        <p className="field-note">
          离线 CPU z-buffer 渲染，固定 {count} 帧。导出冻结 Derivation、CameraPath 与
          RenderSpec；不录制可变 UI。
        </p>
        <button
          type="button"
          className="primary"
          disabled={
            busy !== null ||
            !renderIsValid(settings) ||
            (settings.codec !== "png" &&
              !capabilities.find((c) => c.codec === settings.codec)?.available)
          }
          onClick={() => void exportVideo(workbench)}
        >
          <Download size={16} />
          {busy ? "正在导出" : settings.codec === "png" ? "导出 PNG 序列" : "导出视频"}
        </button>
        {!renderIsValid(settings) && (
          <p className="error-message">视频尺寸、帧数或资源预算无效。</p>
        )}
        {progress !== null && (
          <>
            <progress max="1" value={progress} aria-label="视频导出进度" />
            <span className="muted">{Math.round(progress * 100)}%</span>
            <button type="button" className="secondary" onClick={() => cancel(workbench)}>
              取消导出
            </button>
          </>
        )}
      </section>
    </div>
  );
}
