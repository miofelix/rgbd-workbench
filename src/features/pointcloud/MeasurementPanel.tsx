import { X } from "lucide-react";
import { useWorkbench } from "@/app/state";
export function MeasurementPanel(): React.JSX.Element | null {
  const { selected, clearSelection } = useWorkbench();
  if (!selected.length) return null;
  const [a, b] = selected;
  const distance =
    a !== undefined && b !== undefined
      ? Math.hypot(...a.position.map((v, i) => v - b.position[i]!))
      : null;
  return (
    <section className="measurement">
      <div>
        <span className="eyebrow">SOURCE CAMERA FRAME</span>
        <h3>选点与测量</h3>
      </div>
      {selected.map((p, i) => (
        <p key={p.pixelIndex}>
          P{i + 1} · pixel {p.pixelIndex}
          <code>
            {p.position.map((v) => v.toFixed(5)).join(", ")} {p.unit}
          </code>
        </p>
      ))}
      {distance !== null && a && (
        <strong data-testid="measurement-distance">
          两点距离：{distance.toFixed(6)} {a.unit}
        </strong>
      )}
      <button className="text-button" type="button" onClick={clearSelection}>
        <X size={14} />
        清除选点
      </button>
    </section>
  );
}
