import { useMemo, useRef } from "react";
import type { RgbImage } from "@/compute/codecs/image";
import type { SelectedPoint } from "@/viewer/types";
import { rgbPng, depthPng } from "@/shared/blob-preview";
interface Props {
  rgb: RgbImage | null;
  depth: Uint8Array | null;
  width: number;
  height: number;
  unit: string;
  selected?: readonly SelectedPoint[];
  onPixelSelected?: (pixelIndex: number) => void;
}
function PreviewImage({
  src,
  alt,
  label,
  width,
  height,
  selected,
  onPixelSelected,
}: {
  src: string;
  alt: string;
  label: string;
  width: number;
  height: number;
  selected: readonly SelectedPoint[];
  onPixelSelected?: (pixel: number) => void;
}): React.JSX.Element {
  const imageRef = useRef<HTMLImageElement>(null);
  const select = (event: React.MouseEvent<HTMLImageElement>): void => {
    if (!onPixelSelected || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / width, rect.height / height);
    const x = (event.clientX - rect.left - (rect.width - width * scale) / 2) / scale;
    const y = (event.clientY - rect.top - (rect.height - height * scale) / 2) / scale;
    if (x >= 0 && y >= 0 && x < width && y < height)
      onPixelSelected(Math.floor(y) * width + Math.floor(x));
  };
  return (
    <div className="interactive-preview">
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        onClick={select}
        className={onPixelSelected ? "pixel-selectable" : undefined}
      />
      {selected.map((point) => (
        <span
          key={point.pixelIndex}
          className="pixel-marker"
          style={{
            left: `${(((point.pixelIndex % width) + 0.5) / width) * 100}%`,
            top: `${((Math.floor(point.pixelIndex / width) + 0.5) / height) * 100}%`,
          }}
          title={`像素 ${point.pixelIndex}`}
        />
      ))}
      <span className="preview-label">{label}</span>
    </div>
  );
}
export function SourcePreviews({
  rgb,
  depth,
  width,
  height,
  unit,
  selected = [],
  onPixelSelected,
}: Props): React.JSX.Element {
  const rgbSource = useMemo(() => (rgb ? rgbPng(rgb) : null), [rgb]);
  const depthSource = useMemo(
    () => (depth ? depthPng(depth, width, height) : null),
    [depth, width, height],
  );
  return (
    <div className="source-previews">
      <figure>
        {rgbSource && (
          <PreviewImage
            src={rgbSource}
            alt="RGB 输入预览"
            label={`RGB · ${width} × ${height}`}
            width={width}
            height={height}
            selected={selected}
            onPixelSelected={onPixelSelected ?? (() => undefined)}
          />
        )}
      </figure>
      <figure>
        {depthSource && (
          <PreviewImage
            src={depthSource}
            alt="深度归一化预览"
            label={`DEPTH · ${unit}`}
            width={width}
            height={height}
            selected={selected}
            onPixelSelected={onPixelSelected ?? (() => undefined)}
          />
        )}
      </figure>
    </div>
  );
}
