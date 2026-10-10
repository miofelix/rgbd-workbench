import { Maximize2 } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type { SelectedPoint, ViewSpec } from "../../api/types";
import type { CameraPose } from "../../trajectory/sampler";
import type { PointCloudSceneHandle } from "../../viewer/pointcloud-scene";
import { parsePointCloudPayload } from "./pointcloud-protocol";

export interface PointCloudViewerHandle {
  capturePng: () => string | null;
  resetView: () => void;
  setCameraPose: (pose: CameraPose) => void;
  selectPixel: (pixelIndex: number) => SelectedPoint | null;
}

interface PointCloudViewerProps {
  pointcloudUrl: string;
  onPointSelected: (point: SelectedPoint) => void;
  selectedPoints?: readonly SelectedPoint[];
  viewSpec?: ViewSpec;
  onViewSpecChange?: (patch: Partial<ViewSpec>) => void;
  onReadyChange?: (ready: boolean) => void;
  projectionLocked?: boolean;
}

const DEFAULT_VIEW_SPEC: ViewSpec = {
  projection: "perspective",
  colorMode: "rgb",
  pointSize: 2,
  background: "dark",
};

export const PointCloudViewer = forwardRef<
  PointCloudViewerHandle,
  PointCloudViewerProps
>(function PointCloudViewer(
  {
    pointcloudUrl,
    onPointSelected,
    selectedPoints = [],
    viewSpec = DEFAULT_VIEW_SPEC,
    onViewSpecChange,
    onReadyChange,
    projectionLocked = false,
  },
  ref,
): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<PointCloudSceneHandle | null>(null);
  const latestViewSpec = useRef(viewSpec);
  const latestSelectedPoints = useRef(selectedPoints);
  const readyRef = useRef(false);
  const readinessCallback = useRef(onReadyChange);
  const gesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const ready = !loading && error === null;

  useEffect(() => {
    readinessCallback.current = onReadyChange;
    onReadyChange?.(readyRef.current);
  }, [onReadyChange]);

  useImperativeHandle(
    ref,
    () => ({
      capturePng: () =>
        readyRef.current ? (sceneRef.current?.capturePng() ?? null) : null,
      resetView: () => {
        if (readyRef.current) sceneRef.current?.resetView();
      },
      setCameraPose: (pose) => {
        if (readyRef.current) sceneRef.current?.setCameraPose(pose);
      },
      selectPixel: (pixelIndex) =>
        readyRef.current
          ? (sceneRef.current?.selectPixel(pixelIndex) ?? null)
          : null,
    }),
    [],
  );

  useEffect(() => {
    latestViewSpec.current = viewSpec;
    sceneRef.current?.setViewSpec(viewSpec);
  }, [viewSpec]);

  useEffect(() => {
    latestSelectedPoints.current = selectedPoints;
    sceneRef.current?.setSelectedPoints(selectedPoints);
  }, [selectedPoints]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const controller = new AbortController();
    let pointcloudScene: PointCloudSceneHandle | null = null;
    readyRef.current = false;
    readinessCallback.current?.(false);
    gesture.current = null;
    suppressClick.current = false;
    setError(null);
    setLoading(true);
    void import("../../viewer/pointcloud-scene")
      .then(async ({ createPointCloudScene }) => {
        if (controller.signal.aborted) return null;
        pointcloudScene = createPointCloudScene(canvas);
        sceneRef.current = pointcloudScene;
        pointcloudScene.setViewSpec(latestViewSpec.current);
        pointcloudScene.setSelectedPoints(latestSelectedPoints.current);
        const response = await fetch(pointcloudUrl, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`点云请求失败（HTTP ${response.status}）`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (
          controller.signal.aborted ||
          buffer === null ||
          pointcloudScene === null
        )
          return;
        pointcloudScene.setPoints(parsePointCloudPayload(buffer));
        readyRef.current = true;
        readinessCallback.current?.(true);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setError(cause instanceof Error ? cause.message : "未知协议错误");
      });
    return () => {
      controller.abort();
      readyRef.current = false;
      readinessCallback.current?.(false);
      pointcloudScene?.dispose();
      if (sceneRef.current === pointcloudScene) sceneRef.current = null;
    };
  }, [pointcloudUrl, loadAttempt]);

  return (
    <section
      className="pointcloud-viewer"
      aria-label="点云查看器"
      aria-busy={loading}
    >
      <div className="pointcloud-toolbar">
        <span role="status">
          {loading ? "正在加载点云" : error ? "加载失败" : "点云视图"}
        </span>
        <div className="viewer-controls">
          <div className="segmented-control" aria-label="投影模式">
            <button
              type="button"
              className={viewSpec.projection === "perspective" ? "active" : ""}
              aria-label="透视投影"
              aria-pressed={viewSpec.projection === "perspective"}
              disabled={!ready || projectionLocked}
              title={projectionLocked ? "轨迹预览使用透视投影" : undefined}
              onClick={() => onViewSpecChange?.({ projection: "perspective" })}
            >
              透视
            </button>
            <button
              type="button"
              className={viewSpec.projection === "orthographic" ? "active" : ""}
              aria-label="正交投影"
              aria-pressed={viewSpec.projection === "orthographic"}
              disabled={!ready || projectionLocked}
              title={projectionLocked ? "轨迹预览使用透视投影" : undefined}
              onClick={() => onViewSpecChange?.({ projection: "orthographic" })}
            >
              正交
            </button>
          </div>
          <label className="viewer-select">
            <span>着色</span>
            <select
              aria-label="点云着色"
              disabled={!ready}
              value={viewSpec.colorMode}
              onChange={(event) =>
                onViewSpecChange?.({
                  colorMode: event.target.value as ViewSpec["colorMode"],
                })
              }
            >
              <option value="rgb">RGB</option>
              <option value="depth">深度</option>
              <option value="mono">单色</option>
              <option value="validity">有效性</option>
            </select>
          </label>
          <label className="viewer-range">
            <span>点</span>
            <input
              aria-label="点大小"
              disabled={!ready}
              type="range"
              min="1"
              max="8"
              step="1"
              value={viewSpec.pointSize}
              onChange={(event) =>
                onViewSpecChange?.({ pointSize: Number(event.target.value) })
              }
            />
          </label>
          <button
            type="button"
            className="icon-button small"
            aria-label="适配视图"
            title="适配视图"
            disabled={!ready}
            onClick={() => sceneRef.current?.resetView()}
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        data-testid="pointcloud-canvas"
        aria-label="可交互点云画布"
        aria-disabled={!ready}
        style={{ pointerEvents: ready ? undefined : "none" }}
        onPointerDownCapture={(event) => {
          if (!readyRef.current || event.button !== 0) return;
          if (
            gesture.current &&
            gesture.current.pointerId !== event.pointerId
          ) {
            gesture.current.moved = true;
            suppressClick.current = true;
            return;
          }
          gesture.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
          };
          suppressClick.current = false;
        }}
        onPointerMoveCapture={(event) => {
          const current = gesture.current;
          if (
            current &&
            current.pointerId === event.pointerId &&
            Math.hypot(event.clientX - current.x, event.clientY - current.y) > 5
          ) {
            current.moved = true;
          }
        }}
        onPointerUpCapture={(event) => {
          const current = gesture.current;
          if (!current || current.pointerId !== event.pointerId) return;
          suppressClick.current =
            current.moved ||
            Math.hypot(event.clientX - current.x, event.clientY - current.y) >
              5;
          gesture.current = null;
        }}
        onPointerCancelCapture={() => {
          gesture.current = null;
          suppressClick.current = true;
        }}
        onClick={(event) => {
          if (!readyRef.current) return;
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          const selected = sceneRef.current?.pick(event.clientX, event.clientY);
          if (selected) onPointSelected(selected);
        }}
      />
      {ready && <p className="viewer-hint">拖动旋转 · 滚轮缩放 · 点击选点</p>}
      {error && (
        <div className="viewer-error">
          <p className="notice error" role="alert">
            无法加载点云：{error}
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          >
            重新加载点云
          </button>
        </div>
      )}
    </section>
  );
});
