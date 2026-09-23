interface StatisticsPanelProps {
  scene: {
    rgb: { width: number | null; height: number | null };
    depth: { dtype: string | null; width: number | null; height: number | null };
    depth_spec: { unit: string | null; representation: string } | null;
  } | null;
}

export function StatisticsPanel({ scene }: StatisticsPanelProps): React.JSX.Element {
  if (!scene) {
    return <div className="stats-empty">导入 Scene 后显示深度统计。</div>;
  }
  const pixels = (scene.depth.width ?? 0) * (scene.depth.height ?? 0);
  return (
    <dl className="stats-grid">
      <div><dt>深度像素</dt><dd>{pixels.toLocaleString()}</dd></div>
      <div><dt>数组类型</dt><dd>{scene.depth.dtype ?? "未知"}</dd></div>
      <div><dt>表示</dt><dd>{scene.depth_spec?.representation ?? "未确认"}</dd></div>
      <div><dt>单位</dt><dd>{scene.depth_spec?.unit ?? "未确认"}</dd></div>
    </dl>
  );
}
