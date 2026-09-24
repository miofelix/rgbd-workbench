import { Pause, Play, RotateCcw, Route } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { DerivationManifest } from "../../api/types";
import type { PointCloudViewerHandle } from "../pointcloud/PointCloudViewer";
import {
  sampleCameraPath,
  type CameraPathV1,
  type TrajectoryType,
} from "../../trajectory/sampler";

interface TrajectoryPanelProps {
  derivation: DerivationManifest;
  viewerRef: RefObject<PointCloudViewerHandle | null>;
}

const PRESETS: Array<{
  value: Exclude<TrajectoryType, "custom">;
  label: string;
}> = [
  { value: "orbit", label: "环绕" },
  { value: "elliptical_orbit", label: "椭圆环绕" },
  { value: "dolly", label: "推近 / 拉远" },
  { value: "pan", label: "横移" },
  { value: "lift", label: "升降" },
  { value: "spiral", label: "螺旋" },
  { value: "flyover", label: "飞越" },
  { value: "dolly_zoom", label: "Dolly Zoom" },
];

function targetCenter(
  derivation: DerivationManifest,
): [number, number, number] {
  return derivation.bounds.min.map(
    (value, index) => (value + derivation.bounds.max[index]) / 2,
  ) as [number, number, number];
}

function sceneRadius(derivation: DerivationManifest): number {
  const size = derivation.bounds.max.map(
    (value, index) => value - derivation.bounds.min[index],
  );
  return Math.max(Math.hypot(size[0], size[1], size[2]) * 1.5, 0.1);
}

export function TrajectoryPanel({
  derivation,
  viewerRef,
}: TrajectoryPanelProps): React.JSX.Element {
  const target = useMemo(() => targetCenter(derivation), [derivation]);
  const radius = useMemo(() => sceneRadius(derivation), [derivation]);
  const [trajectoryType, setTrajectoryType] =
    useState<Exclude<TrajectoryType, "custom">>("orbit");
  const [duration, setDuration] = useState(5);
  const [fps, setFps] = useState(30);
  const [loopMode, setLoopMode] = useState<"once" | "loop">("loop");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const currentIndexRef = useRef(0);

  const path = useMemo<CameraPathV1>(
    () => ({
      schema_version: 1,
      frame: derivation.frame,
      unit: derivation.unit,
      trajectory_type: trajectoryType,
      target_source: "manual",
      target,
      duration,
      fps,
      easing: "smoothstep",
      loop_mode: loopMode,
      projection: "perspective",
      fov: 45,
      ortho_scale: radius * 2,
      parameters: { radius, turns: 1 },
      keyframes: [],
      sampler_version: "1",
    }),
    [
      derivation.frame,
      derivation.unit,
      duration,
      fps,
      loopMode,
      radius,
      target,
      trajectoryType,
    ],
  );
  const poses = useMemo(() => sampleCameraPath(path), [path]);

  const applyPose = (index: number): void => {
    const safeIndex = Math.min(poses.length - 1, Math.max(0, index));
    currentIndexRef.current = safeIndex;
    setCurrentIndex(safeIndex);
    viewerRef.current?.setCameraPose(poses[safeIndex]);
  };

  useEffect(() => {
    setPlaying(false);
    applyPose(0);
    // A new derivation or preset must start from its first deterministic pose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    if (!playing) return undefined;
    let animationFrame = 0;
    const initialPhase =
      loopMode === "loop"
        ? currentIndexRef.current / poses.length
        : currentIndexRef.current / Math.max(poses.length - 1, 1);
    const start = performance.now() - initialPhase * duration * 1000;
    const tick = (now: number): void => {
      const elapsed = (now - start) / 1000;
      if (loopMode === "once" && elapsed >= duration) {
        applyPose(poses.length - 1);
        setPlaying(false);
        return;
      }
      const phase =
        loopMode === "loop"
          ? (elapsed % duration) / duration
          : Math.min(1, elapsed / duration);
      const index =
        loopMode === "loop"
          ? Math.floor(phase * poses.length)
          : Math.floor(phase * (poses.length - 1));
      applyPose(index);
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [duration, loopMode, playing, poses, viewerRef]);

  const currentPose = poses[currentIndex] ?? poses[0];
  return (
    <section
      className="panel trajectory-panel"
      aria-labelledby="trajectory-title"
    >
      <div className="panel-heading">
        <div>
          <span className="eyebrow">M3 PREVIEW</span>
          <h3 id="trajectory-title">轨迹预览</h3>
        </div>
        <Route size={17} />
      </div>
      <div className="trajectory-fields">
        <label>
          轨迹预设
          <select
            aria-label="轨迹预设"
            value={trajectoryType}
            onChange={(event) => {
              setPlaying(false);
              setTrajectoryType(
                event.target.value as Exclude<TrajectoryType, "custom">,
              );
            }}
          >
            {PRESETS.map((preset) => (
              <option value={preset.value} key={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          时长（秒）
          <input
            aria-label="轨迹时长"
            type="number"
            min="0.1"
            max="3600"
            step="0.1"
            value={duration}
            onChange={(event) => {
              setPlaying(false);
              setDuration(
                Math.min(
                  3600,
                  Math.max(0.1, Number(event.target.value) || 0.1),
                ),
              );
            }}
          />
        </label>
        <label>
          帧率
          <input
            aria-label="轨迹帧率"
            type="number"
            min="1"
            max="240"
            step="1"
            value={fps}
            onChange={(event) => {
              setPlaying(false);
              setFps(
                Math.min(
                  240,
                  Math.max(1, Math.round(Number(event.target.value) || 1)),
                ),
              );
            }}
          />
        </label>
        <label>
          循环
          <select
            aria-label="轨迹循环模式"
            value={loopMode}
            onChange={(event) => {
              setPlaying(false);
              setLoopMode(event.target.value as "once" | "loop");
            }}
          >
            <option value="loop">循环</option>
            <option value="once">一次</option>
          </select>
        </label>
      </div>
      <div className="trajectory-scrubber">
        <input
          aria-label="轨迹进度"
          type="range"
          min="0"
          max={Math.max(poses.length - 1, 0)}
          value={currentIndex}
          onChange={(event) => {
            setPlaying(false);
            applyPose(Number(event.target.value));
          }}
        />
        <span>
          {currentPose.time.toFixed(2)} / {duration.toFixed(1)} s
        </span>
      </div>
      <div className="trajectory-actions">
        <button
          type="button"
          className="primary"
          aria-label={playing ? "暂停轨迹" : "播放轨迹"}
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? "暂停" : "播放"}
        </button>
        <button
          type="button"
          className="secondary"
          aria-label="重置轨迹"
          title="重置轨迹"
          onClick={() => {
            setPlaying(false);
            applyPose(0);
          }}
        >
          <RotateCcw size={14} />
          重置
        </button>
      </div>
      <div className="trajectory-summary">
        <span>目标（{derivation.unit}）</span>
        <code>{target.map((value) => value.toFixed(3)).join(", ")}</code>
        <span>预览采样</span>
        <strong>{poses.length.toLocaleString()} 帧</strong>
      </div>
      <p className="trajectory-note">
        当前为浏览器视角预览；视频编码与任务队列仍未启用。轨迹不会修改点云派生结果。
      </p>
    </section>
  );
}
