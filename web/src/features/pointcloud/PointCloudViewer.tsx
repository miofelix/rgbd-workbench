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
  },
  ref,
): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<PointCloudSceneHandle | null>(null);
  const latestViewSpec = useRef(viewSpec);
  const latestSelectedPoints = useRef(selectedPoints);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useImperativeHandle(
    ref,
    () => ({
      capturePng: () => sceneRef.current?.capturePng() ?? null,
      resetView: () => sceneRef.current?.resetView(),
      setCameraPose: (pose) => sceneRef.current?.setCameraPose(pose),
      selectPixel: (pixelIndex) =>
        sceneRef.current?.selectPixel(pixelIndex) ?? null,
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
          throw new Error(`Point-cloud request failed (${response.status})`);
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
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setError(cause instanceof Error ? cause.message : "未知协议错误");
      });
    return () => {
      controller.abort();
      pointcloudScene?.dispose();
      if (sceneRef.current === pointcloudScene) sceneRef.current = null;
    };
  }, [pointcloudUrl]);

  return (
    <section className="pointcloud-viewer" aria-label="点云查看器">
      <div className="pointcloud-toolbar">
        <span>{loading ? "正在加载点云" : "点云视图"}</span>
        <div className="viewer-controls">
          <div className="segmented-control" aria-label="投影模式">
            <button
              type="button"
              className={viewSpec.projection === "perspective" ? "active" : ""}
              aria-label="透视投影"
              onClick={() => onViewSpecChange?.({ projection: "perspective" })}
            >
              透视
            </button>
            <button
              type="button"
              className={viewSpec.projection === "orthographic" ? "active" : ""}
              aria-label="正交投影"
              onClick={() => onViewSpecChange?.({ projection: "orthographic" })}
            >
              正交
            </button>
          </div>
          <label className="viewer-select">
            <span>着色</span>
            <select
              aria-label="点云着色"
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
        onClick={(event) => {
          const selected = sceneRef.current?.pick(event.clientX, event.clientY);
          if (selected) onPointSelected(selected);
        }}
      />
      {error && (
        <p className="notice error" role="alert">
          点云数据无效：{error}
        </p>
      )}
    </section>
  );
});
