import { Pause, Play, RotateCcw, Route } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import type { DerivationManifest } from "../../api/types";
import type { PointCloudViewerHandle } from "../pointcloud/PointCloudViewer";
import {
  sampleCameraPath,
  frameCount,
  type CameraPathV1,
  type TrajectoryType,
} from "../../trajectory/sampler";

interface TrajectoryPanelProps {
  derivation: DerivationManifest;
  viewerRef: RefObject<PointCloudViewerHandle | null>;
  viewerReady?: boolean;
}

const PREVIEW_FRAME_BUDGET = 6_000;

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
  viewerReady = true,
}: TrajectoryPanelProps): React.JSX.Element {
  const target = useMemo(() => targetCenter(derivation), [derivation]);
  const radius = useMemo(() => sceneRadius(derivation), [derivation]);
  const [trajectoryType, setTrajectoryType] =
    useState<Exclude<TrajectoryType, "custom">>("orbit");
  const [durationInput, setDurationInput] = useState("5");
  const [fpsInput, setFpsInput] = useState("30");
  const [loopMode, setLoopMode] = useState<"once" | "loop">("loop");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const currentIndexRef = useRef(0);
  const validationId = useId();
  const duration = durationInput === "" ? Number.NaN : Number(durationInput);
  const fps = fpsInput === "" ? Number.NaN : Number(fpsInput);
  const durationValid =
    Number.isFinite(duration) && duration >= 0.1 && duration <= 3600;
  const fpsValid = Number.isInteger(fps) && fps >= 1 && fps <= 240;
  const previewFrameCount =
    durationValid && fpsValid ? frameCount(duration, fps) : 0;
  const overBudget = previewFrameCount > PREVIEW_FRAME_BUDGET;
  const validationMessage = !durationValid
    ? "时长必须是 0.1–3600 秒之间的有限数值。"
    : !fpsValid
      ? "帧率必须是 1–240 之间的整数。"
      : overBudget
        ? `浏览器预览最多支持 6,000 帧，当前设置需要 ${previewFrameCount.toLocaleString("zh-CN")} 帧。请缩短时长或降低帧率。`
        : null;

  const path = useMemo<CameraPathV1 | null>(
    () =>
      validationMessage === null
        ? {
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
          }
        : null,
    [
      derivation.frame,
      derivation.unit,
      duration,
      fps,
      loopMode,
      radius,
      target,
      trajectoryType,
      validationMessage,
    ],
  );
  const poses = useMemo(
    () => (path === null ? [] : sampleCameraPath(path)),
    [path],
  );
  const previewReady = viewerReady && poses.length > 0;

  const applyPose = useCallback(
    (index: number): void => {
      if (poses.length === 0 || !Number.isFinite(index)) return;
      const safeIndex = Math.min(
        poses.length - 1,
        Math.max(0, Math.trunc(index)),
      );
      currentIndexRef.current = safeIndex;
      setCurrentIndex(safeIndex);
    },
    [poses],
  );

  useEffect(() => {
    setPlaying(false);
    currentIndexRef.current = 0;
    setCurrentIndex(0);
    // A new derivation or preset must start from its first deterministic pose.
  }, [poses]);

  useEffect(() => {
    if (!viewerReady) {
      setPlaying(false);
      return;
    }
    const pose = poses[currentIndexRef.current] ?? poses[0];
    if (pose) viewerRef.current?.setCameraPose(pose);
  }, [currentIndex, poses, viewerReady, viewerRef]);

  useEffect(() => {
    if (!playing || !previewReady) return undefined;
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
  }, [applyPose, duration, loopMode, playing, poses, previewReady]);

  const currentPose = poses[currentIndex] ?? poses[0];
  return (
    <section
      className="panel trajectory-panel"
      aria-labelledby="trajectory-title"
    >
      <div className="panel-heading">
        <div>
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
            value={durationInput}
            aria-invalid={!durationValid || overBudget}
            aria-describedby={validationMessage ? validationId : undefined}
            onChange={(event) => {
              setPlaying(false);
              setDurationInput(event.target.value);
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
            value={fpsInput}
            aria-invalid={!fpsValid || overBudget}
            aria-describedby={validationMessage ? validationId : undefined}
            onChange={(event) => {
              setPlaying(false);
              setFpsInput(event.target.value);
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
      {validationMessage && (
        <p id={validationId} className="diagnostic warning" role="alert">
          {validationMessage}
        </p>
      )}
      <div className="trajectory-scrubber">
        <input
          aria-label="轨迹进度"
          type="range"
          min="0"
          max={Math.max(poses.length - 1, 0)}
          value={currentIndex}
          disabled={!previewReady}
          onChange={(event) => {
            setPlaying(false);
            applyPose(Number(event.target.value));
          }}
        />
        <span>
          {currentPose?.time.toFixed(2) ?? "—"} /{" "}
          {durationValid ? duration.toFixed(1) : "—"} s
        </span>
      </div>
      <div className="trajectory-actions">
        <button
          type="button"
          className="primary"
          aria-label={playing ? "暂停轨迹" : "播放轨迹"}
          disabled={!previewReady}
          onClick={() => {
            if (
              !playing &&
              loopMode === "once" &&
              currentIndexRef.current === poses.length - 1
            )
              applyPose(0);
            setPlaying((value) => !value);
          }}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? "暂停" : "播放"}
        </button>
        <button
          type="button"
          className="secondary"
          aria-label="重置轨迹"
          title="重置轨迹"
          disabled={!previewReady}
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
        <strong>
          {poses.length > 0
            ? `${poses.length.toLocaleString("zh-CN")} 帧`
            : "未采样"}
        </strong>
      </div>
      <p className="trajectory-note">
        {viewerReady
          ? "仅预览相机轨迹，暂不支持视频编码。"
          : "点云载入后可预览相机轨迹，暂不支持视频编码。"}
      </p>
    </section>
  );
}
