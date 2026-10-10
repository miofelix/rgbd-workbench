import { Camera, Download } from "lucide-react";
import { type RefObject, useState } from "react";

import type { DerivationResponse } from "../../api/types";
import type { PointCloudViewerHandle } from "./PointCloudViewer";

interface ExportActionsProps {
  urls: DerivationResponse["urls"];
  viewerRef: RefObject<PointCloudViewerHandle | null>;
  displayName: string;
  ready?: boolean;
}

function safeName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-") || "rgbd-scene";
}

export function ExportActions({
  urls,
  viewerRef,
  displayName,
  ready = true,
}: ExportActionsProps): React.JSX.Element {
  const name = safeName(displayName);
  const [error, setError] = useState<string | null>(null);
  const downloadPng = (): void => {
    if (!ready) return;
    setError(null);
    try {
      const dataUrl = viewerRef.current?.capturePng();
      if (!dataUrl) throw new Error("Point-cloud view is not ready");
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = `${name}-pointcloud.png`;
      anchor.click();
    } catch {
      setError("截图失败，请重试。");
    }
  };
  return (
    <section
      className="panel export-panel"
      id="static-exports"
      aria-labelledby="export-title"
    >
      <div className="panel-heading">
        <h3 id="export-title">静态导出</h3>
        <Download size={17} />
      </div>
      <div className="export-actions">
        <a className="secondary" href={urls.ply} download={`${name}.ply`}>
          <Download size={14} /> 下载 PLY
        </a>
        <a
          className="secondary"
          href={urls.json}
          download={`${name}-parameters.json`}
        >
          <Download size={14} /> 下载参数 JSON
        </a>
        <button
          type="button"
          className="secondary"
          aria-label="下载 PNG"
          disabled={!ready}
          title={ready ? "保存当前点云视图" : "等待点云加载完成"}
          onClick={downloadPng}
        >
          <Camera size={14} /> 下载 PNG
        </button>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
