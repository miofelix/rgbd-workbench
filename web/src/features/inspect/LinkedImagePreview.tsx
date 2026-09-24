import type { MouseEvent } from "react";

import type { SelectedPoint } from "../../api/types";

interface LinkedImagePreviewProps {
  src: string;
  alt: string;
  sourceWidth: number;
  sourceHeight: number;
  selectedPoints: readonly SelectedPoint[];
  onPixelSelected: (pixelIndex: number) => void;
}

interface ImageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function pixelIndexFromContainedImage(
  rect: ImageRect,
  sourceWidth: number,
  sourceHeight: number,
  clientX: number,
  clientY: number,
): number | null {
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }
  const sourceAspect = sourceWidth / sourceHeight;
  const boxAspect = rect.width / rect.height;
  const renderedWidth =
    sourceAspect > boxAspect ? rect.width : rect.height * sourceAspect;
  const renderedHeight =
    sourceAspect > boxAspect ? rect.width / sourceAspect : rect.height;
  const left = rect.left + (rect.width - renderedWidth) / 2;
  const top = rect.top + (rect.height - renderedHeight) / 2;
  if (
    clientX < left ||
    clientX >= left + renderedWidth ||
    clientY < top ||
    clientY >= top + renderedHeight
  ) {
    return null;
  }
  const x = Math.min(
    sourceWidth - 1,
    Math.floor(((clientX - left) / renderedWidth) * sourceWidth),
  );
  const y = Math.min(
    sourceHeight - 1,
    Math.floor(((clientY - top) / renderedHeight) * sourceHeight),
  );
  return y * sourceWidth + x;
}

export function LinkedImagePreview({
  src,
  alt,
  sourceWidth,
  sourceHeight,
  selectedPoints,
  onPixelSelected,
}: LinkedImagePreviewProps): React.JSX.Element {
  const markerRadius = Math.max(sourceWidth, sourceHeight) * 0.035;
  const selectPixel = (event: MouseEvent<HTMLButtonElement>): void => {
    const pixelIndex = pixelIndexFromContainedImage(
      event.currentTarget.getBoundingClientRect(),
      sourceWidth,
      sourceHeight,
      event.clientX,
      event.clientY,
    );
    if (pixelIndex !== null) onPixelSelected(pixelIndex);
  };

  return (
    <button
      type="button"
      className="linked-image-preview"
      aria-label={`在 ${alt}中选择像素`}
      onClick={selectPixel}
    >
      <img src={src} alt={alt} />
      <svg
        className="image-selection-overlay"
        viewBox={`0 0 ${sourceWidth} ${sourceHeight}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        {selectedPoints.map((point, index) => {
          const x = (point.pixelIndex % sourceWidth) + 0.5;
          const y = Math.floor(point.pixelIndex / sourceWidth) + 0.5;
          if (y >= sourceHeight) return null;
          return (
            <g
              key={point.pixelIndex}
              data-testid={`selection-marker-${point.pixelIndex}`}
              className={`image-selection-marker marker-${index + 1}`}
            >
              <circle cx={x} cy={y} r={markerRadius} />
              <line
                x1={x - markerRadius * 1.5}
                x2={x + markerRadius * 1.5}
                y1={y}
                y2={y}
              />
              <line
                x1={x}
                x2={x}
                y1={y - markerRadius * 1.5}
                y2={y + markerRadius * 1.5}
              />
            </g>
          );
        })}
      </svg>
    </button>
  );
}
