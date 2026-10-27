import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import type { PointCloudBuffer } from "@/domain/derivation";
import type { CameraPath } from "@/domain/trajectory";
import { createPointCloudScene, type PointCloudScene } from "@/viewer/pointcloud-scene";
import type { SelectedPoint, ViewSpec } from "@/viewer/types";
export interface ViewerHandle {
  capturePng: () => string | null;
  cameraSnapshot: () => import("@/viewer/pointcloud-scene").ViewerCameraSnapshot | null;
  selectPixel: (pixelIndex: number) => SelectedPoint | null;
}
interface Props {
  data: PointCloudBuffer;
  view: ViewSpec;
  selected: readonly SelectedPoint[];
  onSelect: (point: SelectedPoint) => void;
  trajectory?: { path: CameraPath; frame: number; fps: number } | null;
}
export const PointCloudViewer = forwardRef<ViewerHandle, Props>(function PointCloudViewer(
  { data, view, selected, onSelect, trajectory },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<PointCloudScene | null>(null);
  const callback = useRef(onSelect);
  callback.current = onSelect;
  const [error, setError] = useState<string | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      capturePng: () => sceneRef.current?.capturePng() ?? null,
      cameraSnapshot: () => sceneRef.current?.cameraSnapshot() ?? null,
      selectPixel: (pixelIndex) => sceneRef.current?.selectPixel(pixelIndex) ?? null,
    }),
    [],
  );
  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      sceneRef.current = createPointCloudScene(
        canvasRef.current,
        data,
        (point) => callback.current(point),
        view,
      );
      sceneRef.current.setView(view);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "WebGL2 不可用");
    }
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [data]);
  useEffect(() => {
    sceneRef.current?.setView(view);
  }, [view]);
  useEffect(() => {
    sceneRef.current?.setSelection(selected);
  }, [selected]);
  useEffect(() => {
    sceneRef.current?.setTrajectory(
      trajectory?.path ?? null,
      trajectory?.frame ?? 0,
      trajectory?.fps ?? 30,
    );
  }, [trajectory]);
  return (
    <div className="pointcloud-stage">
      <canvas
        ref={canvasRef}
        data-testid="pointcloud-canvas"
        aria-label="可旋转的点云三维视图，点击点进行选择"
      />
      {error && <p className="canvas-error">{error}</p>}
      <span className="viewer-caption">
        {data.manifest.pointCount.toLocaleString()} 点 · {data.manifest.unit}
      </span>
    </div>
  );
});
