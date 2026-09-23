import { Copy, Ruler, X } from "lucide-react";

import type { SelectedPoint } from "../../api/types";

interface MeasurementPanelProps {
  points: SelectedPoint[];
  onClear: () => void;
  embedded?: boolean;
}

function coordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "—";
}

export function MeasurementPanel({
  points,
  onClear,
  embedded = false,
}: MeasurementPanelProps): React.JSX.Element {
  const distance =
    points.length === 2
      ? Math.hypot(
          points[1].position[0] - points[0].position[0],
          points[1].position[1] - points[0].position[1],
          points[1].position[2] - points[0].position[2],
        )
      : null;
  const unit = points[0]?.unit;

  return (
    <section
      className={`${embedded ? "" : "panel "}measurement-panel`}
      aria-labelledby="measurement-title"
    >
      <div className="panel-heading">
        <h3 id="measurement-title">选点与测量</h3>
        <Ruler size={17} />
      </div>
      {points.length === 0 ? (
        <p className="measurement-empty">在点云中选择两个点以测量距离。</p>
      ) : (
        <>
          <div className="selected-point-list">
            {points.map((point, index) => (
              <div key={point.pixelIndex}>
                <strong>{String.fromCharCode(65 + index)}</strong>
                <span>px {point.pixelIndex}</span>
                <code>{point.position.map(coordinate).join(", ")}</code>
              </div>
            ))}
          </div>
          {distance !== null && (
            <div
              className="measurement-distance"
              data-testid="measurement-distance"
            >
              <span>距离</span>
              <strong>
                {distance.toFixed(4)} {unit}
              </strong>
            </div>
          )}
          <div className="measurement-actions">
            {distance !== null && unit === "m" && (
              <button
                type="button"
                className="secondary"
                aria-label="复制米制距离"
                title="复制米制距离"
                onClick={() =>
                  void navigator.clipboard?.writeText(distance.toFixed(6))
                }
              >
                <Copy size={14} /> 复制米制距离
              </button>
            )}
            <button
              type="button"
              className="secondary"
              aria-label="清除选点"
              onClick={onClear}
            >
              <X size={14} /> 清除选点
            </button>
          </div>
        </>
      )}
    </section>
  );
}
