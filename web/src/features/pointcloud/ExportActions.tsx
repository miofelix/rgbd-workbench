import { Camera, Download } from "lucide-react";
import type { RefObject } from "react";

import type { DerivationResponse } from "../../api/types";
import type { PointCloudViewerHandle } from "./PointCloudViewer";

interface ExportActionsProps {
  urls: DerivationResponse["urls"];
  viewerRef: RefObject<PointCloudViewerHandle | null>;
  displayName: string;
}

function safeName(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-") || "rgbd-scene";
}

export function ExportActions({
  urls,
  viewerRef,
  displayName,
}: ExportActionsProps): React.JSX.Element {
  const name = safeName(displayName);
  const downloadPng = (): void => {
    const dataUrl = viewerRef.current?.capturePng();
    if (!dataUrl) return;
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `${name}-pointcloud.png`;
    anchor.click();
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
          onClick={downloadPng}
        >
          <Camera size={14} /> 下载 PNG
        </button>
      </div>
    </section>
  );
}
