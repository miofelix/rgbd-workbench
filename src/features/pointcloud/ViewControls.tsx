import { useWorkbench } from "@/app/state";
export function ViewControls(): React.JSX.Element {
  const { view, setView } = useWorkbench();
  return (
    <div className="viewer-controls">
      <select
        aria-label="投影模式"
        value={view.projection}
        onChange={(e) => setView({ projection: e.target.value as typeof view.projection })}
      >
        <option value="perspective">透视</option>
        <option value="orthographic">正交</option>
      </select>
      <select
        aria-label="点云着色"
        value={view.colorMode}
        onChange={(e) => setView({ colorMode: e.target.value as typeof view.colorMode })}
      >
        <option value="rgb">RGB</option>
        <option value="depth">深度</option>
        <option value="mono">单色</option>
        <option value="validity">有效性</option>
      </select>
      <select
        aria-label="色图"
        value={view.colorMap}
        onChange={(e) => setView({ colorMap: e.target.value as typeof view.colorMap })}
      >
        <option value="turbo">Turbo</option>
        <option value="viridis">Viridis</option>
        <option value="inferno">Inferno</option>
        <option value="magma">Magma</option>
        <option value="plasma">Plasma</option>
        <option value="cividis">Cividis</option>
        <option value="gray">Gray</option>
      </select>
      <label>
        点大小
        <input
          aria-label="点大小"
          type="range"
          min="1"
          max="8"
          value={view.pointSize}
          onChange={(e) => setView({ pointSize: Number(e.target.value) })}
        />
      </label>
      <button
        type="button"
        className="icon-button"
        title="切换背景"
        aria-label="切换背景"
        onClick={() => setView({ background: view.background === "dark" ? "light" : "dark" })}
      >
        ◐
      </button>
    </div>
  );
}
