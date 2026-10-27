import { Camera, Download } from "lucide-react";
import type { RefObject } from "react";
import { useWorkbench } from "@/app/state";
import { downloadBlob, encodeParameters, encodePly, safeFilename } from "@/compute/export";
import type { ViewerHandle } from "./PointCloudViewer";
export function ExportActions({
  viewerRef,
}: {
  viewerRef: RefObject<ViewerHandle | null>;
}): React.JSX.Element | null {
  const { derivation, scene } = useWorkbench();
  if (!derivation || !scene) return null;
  const name = safeFilename(scene.name);
  return (
    <div className="export-actions">
      <button
        className="secondary"
        type="button"
        onClick={() =>
          downloadBlob(
            new Blob([encodePly(derivation.manifest, derivation.arrays).slice().buffer], {
              type: "application/octet-stream",
            }),
            `${name}.ply`,
          )
        }
      >
        <Download size={15} />
        下载 PLY
      </button>
      <button
        className="secondary"
        type="button"
        onClick={() =>
          downloadBlob(
            new Blob([encodeParameters(derivation.manifest).slice().buffer], {
              type: "application/json",
            }),
            `${name}-parameters.json`,
          )
        }
      >
        <Download size={15} />
        下载参数 JSON
      </button>
      <button
        className="secondary"
        aria-label="下载 PNG"
        type="button"
        onClick={async () => {
          const blob = await viewerRef.current?.capturePng();
          if (blob) downloadBlob(blob, `${name}-pointcloud.png`);
        }}
      >
        <Camera size={15} />
        下载 PNG
      </button>
    </div>
  );
}
