import type { NumericArray } from "@/domain/codec-registry";
import type { PointCloudBuffer } from "@/domain/derivation";
export function StatisticsPanel({
  depth,
  cloud,
}: {
  depth: NumericArray | null;
  cloud: PointCloudBuffer | null;
}): React.JSX.Element {
  let valid = 0;
  let min = Infinity;
  let max = -Infinity;
  if (depth)
    for (const value of depth.data)
      if (Number.isFinite(value) && value > 0) {
        valid += 1;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
  return (
    <section className="statistics-panel">
      <span className="eyebrow">DATA SUMMARY</span>
      <h3>统计与联动</h3>
      <dl>
        <div>
          <dt>有效深度</dt>
          <dd>{depth ? `${valid} / ${depth.data.length}` : "—"}</dd>
        </div>
        <div>
          <dt>无效深度</dt>
          <dd>{depth ? depth.data.length - valid : "—"}</dd>
        </div>
        <div>
          <dt>源值范围</dt>
          <dd>{valid ? `${min.toPrecision(5)} – ${max.toPrecision(5)}` : "—"}</dd>
        </div>
        <div>
          <dt>派生点</dt>
          <dd>{cloud?.manifest.pointCount.toLocaleString() ?? "尚未应用"}</dd>
        </div>
        <div>
          <dt>相机坐标范围</dt>
          <dd>
            {cloud
              ? `${cloud.manifest.bounds.min.map((v) => v.toFixed(3)).join(", ")} → ${cloud.manifest.bounds.max.map((v) => v.toFixed(3)).join(", ")}`
              : "—"}
          </dd>
        </div>
      </dl>
      <p>二维点击选择最近的派生代表像素；体素与预算抽样不会伪造被删除像素的 XYZ。</p>
    </section>
  );
}
