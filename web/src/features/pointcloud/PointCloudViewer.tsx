import { Maximize2 } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type { SelectedPoint } from "../../api/types";
import {
  createPointCloudScene,
  type PointCloudSceneHandle,
} from "../../viewer/pointcloud-scene";
import { parsePointCloudPayload } from "./pointcloud-protocol";

export interface PointCloudViewerHandle {
  capturePng: () => string | null;
  resetView: () => void;
}

interface PointCloudViewerProps {
  pointcloudUrl: string;
  onPointSelected: (point: SelectedPoint) => void;
}

export const PointCloudViewer = forwardRef<
  PointCloudViewerHandle,
  PointCloudViewerProps
>(function PointCloudViewer(
  { pointcloudUrl, onPointSelected },
  ref,
): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<PointCloudSceneHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useImperativeHandle(
    ref,
    () => ({
      capturePng: () => sceneRef.current?.capturePng() ?? null,
      resetView: () => sceneRef.current?.resetView(),
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const controller = new AbortController();
    const pointcloudScene = createPointCloudScene(canvas);
    sceneRef.current = pointcloudScene;
    setError(null);
    setLoading(true);
    void fetch(pointcloudUrl, {
      credentials: "include",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`Point-cloud request failed (${response.status})`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (controller.signal.aborted) return;
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
      pointcloudScene.dispose();
      if (sceneRef.current === pointcloudScene) sceneRef.current = null;
    };
  }, [pointcloudUrl]);

  return (
    <section className="pointcloud-viewer" aria-label="点云查看器">
      <div className="pointcloud-toolbar">
        <span>{loading ? "正在加载点云" : "点云视图"}</span>
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
