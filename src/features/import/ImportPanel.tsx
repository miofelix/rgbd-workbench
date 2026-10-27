import { useState } from "react";
import { FileUp, Save, ShieldCheck } from "lucide-react";
import type { Workbench } from "@/application/workbench";
import type { SourceSelection } from "@/application/contracts";
import { geometryContractSchema } from "@/domain/scene";
import { useWorkbench } from "@/app/state";
import { diagnosticText } from "@/domain/diagnostics";

export function ImportPanel({ workbench }: { workbench: Workbench }): React.JSX.Element {
  const { preparation, busy, diagnostics, prepare, commit, restore } = useWorkbench();
  const [importError, setImportError] = useState<string | null>(null);
  const [rgb, setRgb] = useState<File | null>(null);
  const [depth, setDepth] = useState<File | null>(null);
  const [manifest, setManifest] = useState<File | undefined>();
  const [name, setName] = useState("Untitled Scene");
  const [representation, setRepresentation] = useState<"z_depth" | "relative_z">("relative_z");
  const [unit, setUnit] = useState<"m" | "mm" | "unitless">("unitless");
  const [fx, setFx] = useState("");
  const [fy, setFy] = useState("");
  const [cx, setCx] = useState("");
  const [cy, setCy] = useState("");
  const [intrinsicsEdited, setIntrinsicsEdited] = useState(false);
  const [intrinsicsConfirmed, setIntrinsicsConfirmed] = useState(false);
  const load = async (
    nextRgb = rgb,
    nextDepth = depth,
    nextManifest = manifest,
    force = false,
  ): Promise<void> => {
    if (
      !force &&
      (!nextRgb ||
        !nextDepth ||
        (nextRgb === rgb && nextDepth === depth && nextManifest === manifest))
    )
      return;
    if (!nextRgb || !nextDepth) return;
    const selection: SourceSelection = {
      rgb: nextRgb,
      depth: nextDepth,
      ...(nextManifest ? { manifest: nextManifest } : {}),
    };
    await prepare(workbench, selection);
    const latest = useWorkbench.getState().preparation;
    setImportError(latest ? null : useWorkbench.getState().error);
    const latestName = latest?.suggestedName;
    if (latest) {
      const geometry = latest.suggestedGeometry;
      setName(latestName ?? nextRgb.name.replace(/\.[^.]+$/, ""));
      if (geometry.depth) {
        setRepresentation(geometry.depth.representation);
        setUnit(geometry.depth.unit);
      }
      if (geometry.camera) {
        setFx(String(geometry.camera.fx));
        setFy(String(geometry.camera.fy));
        setCx(String(geometry.camera.cx));
        setCy(String(geometry.camera.cy));
      }
      setIntrinsicsEdited(false);
    }
  };
  const save = async (): Promise<void> => {
    if (!preparation) return;
    const suggested = preparation.suggestedGeometry;
    const width = preparation.depth?.width ?? 0;
    const height = preparation.depth?.height ?? 0;
    const camera =
      !intrinsicsEdited && suggested.camera
        ? suggested.camera
        : {
            model: "pinhole" as const,
            width,
            height,
            fx: Number(fx || width),
            fy: Number(fy || width),
            cx: Number(cx || (width - 1) / 2),
            cy: Number(cy || (height - 1) / 2),
            distortionModel: "none" as const,
          };
    if (!intrinsicsConfirmed) {
      useWorkbench.setState({
        error: "请明确确认相机内参与已注册/校正状态；未标定的估计值不能当作真实几何。",
      });
      return;
    }
    const geometry = geometryContractSchema.parse({
      depth: {
        representation,
        unit: representation === "relative_z" ? "unitless" : unit === "unitless" ? "m" : unit,
        scaleToMeter: null,
        invalidValues: [],
        validMin: null,
        validMax: null,
      },
      camera,
      alignment: { state: "registered_to_rgb", method: "user_confirmed" },
      rawDescriptor: preparation.rawDescriptor ?? null,
    });
    await commit(workbench, name, geometry);
    setImportError(useWorkbench.getState().scene ? null : useWorkbench.getState().error);
  };
  const input = (
    label: string,
    accept: string,
    onChange: (file: File | undefined) => void,
  ): React.JSX.Element => (
    <label className="file-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files?.[0])}
      />
    </label>
  );
  return (
    <section className="panel import-panel" aria-labelledby="import-heading">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">LOCAL INPUT</span>
          <h2 id="import-heading">导入 RGB-D Scene</h2>
        </div>
        <FileUp size={19} />
      </div>
      <p className="panel-intro">文件仅在浏览器内解析。深度单位、内参与对齐关系由你明确确认。</p>
      <div className="file-grid archive-input">
        <label className="file-field">
          <span>恢复 Source Archive</span>
          <input
            aria-label="恢复 Source Archive"
            type="file"
            accept=".zip,.rgbd.zip"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void restore(workbench, file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <div className="file-grid">
        {input("RGB 图像文件", ".png,.jpg,.jpeg,.webp,.tif,.tiff", (file) => {
          setRgb(file ?? null);
          void load(file ?? null, depth, manifest, true);
        })}
        {input("深度数据文件", ".npy,.npz,.pfm,.raw,.bin,.tif,.tiff", (file) => {
          setDepth(file ?? null);
          void load(rgb, file ?? null, manifest, true);
        })}
        {input("可选 manifest 文件", ".json,.yaml,.yml", (file) => {
          setManifest(file);
          void load(rgb, depth, file, true);
        })}
      </div>
      {busy && (
        <p className="status-message" role="status">
          {busy}
        </p>
      )}
      {importError && (
        <p className="error-message" role="alert">
          {importError}
        </p>
      )}
      {preparation && (
        <div className="geometry-form">
          <div className="probe-summary">
            <ShieldCheck size={18} />
            <span>
              已解码 {preparation.depth?.width} × {preparation.depth?.height} ·{" "}
              {preparation.depth?.dataType}
              <small>导入成功不代表具备米制几何能力</small>
            </span>
          </div>
          <label>
            Scene 名称
            <input aria-label="Scene 名称" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="form-grid two">
            <label>
              深度表示
              <select
                aria-label="深度表示"
                value={representation}
                onChange={(e) => {
                  const value = e.target.value as typeof representation;
                  setRepresentation(value);
                  setUnit(value === "relative_z" ? "unitless" : "m");
                }}
              >
                <option value="relative_z">relative_z · 相对深度</option>
                <option value="z_depth">z_depth · 相机 Z 深度</option>
              </select>
            </label>
            <label>
              单位
              <select
                aria-label="深度单位"
                value={representation === "relative_z" ? "unitless" : unit}
                disabled={representation === "relative_z"}
                onChange={(e) => setUnit(e.target.value as typeof unit)}
              >
                <option value="m">米 (m)</option>
                <option value="mm">毫米 (mm)</option>
                <option value="unitless">unitless</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend>已注册到 RGB 的 pinhole 内参</legend>
            <div className="form-grid four">
              {(
                [
                  ["fx", fx, setFx],
                  ["fy", fy, setFy],
                  ["cx", cx, setCx],
                  ["cy", cy, setCy],
                ] as const
              ).map(([label, value, set]) => (
                <label key={label}>
                  {label}
                  <input
                    aria-label={`相机 ${label}`}
                    type="number"
                    step="any"
                    value={value}
                    onChange={(e) => {
                      (set as (s: string) => void)(e.target.value);
                      setIntrinsicsEdited(true);
                    }}
                  />
                </label>
              ))}
            </div>
            <p className="field-note">
              已解码尺寸 {preparation.depth?.width} × {preparation.depth?.height}；默认值为显示用的
              pinhole 估计，请按数据标定结果确认。manifest 会优先提供显式值。
            </p>
          </fieldset>
          <label className="confirm-geometry">
            <input
              aria-label="确认几何合同"
              type="checkbox"
              checked={intrinsicsConfirmed}
              onChange={(e) => setIntrinsicsConfirmed(e.target.checked)}
            />
            我确认上述内参来自数据标定/显式声明，RGB 与深度已对齐且已校正
          </label>
          <button
            type="button"
            className="primary"
            disabled={busy !== null || !name.trim() || !intrinsicsConfirmed}
            onClick={() => void save()}
          >
            <Save size={16} />
            保存 Scene
          </button>
        </div>
      )}
      {diagnostics.length > 0 && (
        <div className="diagnostic-list">
          {diagnostics.map((item) => (
            <p className={item.severity} key={item.code}>
              <strong>{item.code}</strong>
              {diagnosticText(item)}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
