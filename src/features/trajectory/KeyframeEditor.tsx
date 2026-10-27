import { Plus, Trash2 } from "lucide-react";
import type { CameraPath, Keyframe } from "@/domain/trajectory";
import type { ViewerCameraSnapshot } from "@/viewer/pointcloud-scene";

interface Props {
  path: CameraPath;
  onChange: (path: CameraPath) => void;
  onAdd: () => void;
}
export function KeyframeEditor({ path, onChange, onAdd }: Props): React.JSX.Element {
  const frames = path.keyframes;
  const update = (index: number, patch: Partial<Keyframe>): void => {
    const keyframes = frames
      .map((frame, i) => (i === index ? { ...frame, ...patch } : frame))
      .sort((a, b) => a.time - b.time);
    onChange({ ...path, kind: "custom", keyframes });
  };
  return (
    <section className="keyframe-editor">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">KEYFRAME TRACK</span>
          <h3>关键帧编辑</h3>
        </div>
        <button className="secondary" type="button" onClick={onAdd}>
          <Plus size={15} />
          添加当前视角
        </button>
      </div>
      {frames.length === 0 && (
        <p className="field-note">添加至少两个视角后使用自定义轨迹；时间与参数在应用时严格校验。</p>
      )}
      {frames.map((frame, index) => (
        <div className="keyframe-row" key={`${frame.time}-${index}`}>
          <strong>K{index + 1}</strong>
          <label>
            时间
            <input
              aria-label={`关键帧 ${index + 1} 时间`}
              type="number"
              min="0"
              max={path.duration}
              step="0.1"
              value={frame.time}
              onChange={(e) => update(index, { time: Number(e.target.value) })}
            />
          </label>
          {(["position", "target"] as const).map((field) => (
            <fieldset key={field}>
              <legend>{field}</legend>
              <div className="form-grid three">
                {frame[field].map((value, axis) => (
                  <label key={axis}>
                    {"XYZ"[axis]}
                    <input
                      aria-label={`关键帧 ${index + 1} ${field} ${"xyz"[axis]}`}
                      type="number"
                      step="any"
                      value={value}
                      onChange={(e) => {
                        const vector = [...frame[field]] as (typeof frame)[typeof field];
                        vector[axis] = Number(e.target.value);
                        update(index, { [field]: vector });
                      }}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <label>
            FOV
            <input
              aria-label={`关键帧 ${index + 1} FOV`}
              type="number"
              min="1"
              max="179"
              value={frame.fov}
              onChange={(e) => update(index, { fov: Number(e.target.value) })}
            />
          </label>
          <label>
            缓动
            <select
              aria-label={`关键帧 ${index + 1} 缓动`}
              value={frame.easing}
              onChange={(e) => update(index, { easing: e.target.value as Keyframe["easing"] })}
            >
              <option value="linear">linear</option>
              <option value="smoothstep">smoothstep</option>
              <option value="ease_in_out_cubic">ease_in_out_cubic</option>
            </select>
          </label>
          <button
            type="button"
            className="icon-button small"
            aria-label={`删除关键帧 ${index + 1}`}
            disabled={frames.length <= 2}
            onClick={() =>
              onChange({ ...path, kind: "custom", keyframes: frames.filter((_, i) => i !== index) })
            }
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </section>
  );
}
export function snapshotKeyframe(snapshot: ViewerCameraSnapshot, time: number): Keyframe {
  return { time, ...snapshot, easing: "smoothstep" };
}
