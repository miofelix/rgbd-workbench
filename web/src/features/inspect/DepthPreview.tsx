import { ImageOff } from "lucide-react";

interface DepthPreviewProps {
  src?: string;
  label?: string;
}

export function DepthPreview({ src, label = "深度预览" }: DepthPreviewProps): React.JSX.Element {
  return (
    <div className="preview-frame depth-preview">
      {src ? (
        <img src={src} alt={label} />
      ) : (
        <div className="preview-empty"><ImageOff size={21} /><span>确认深度语义后显示</span></div>
      )}
      <span className="preview-label">{label}</span>
    </div>
  );
}
