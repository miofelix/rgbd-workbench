import { create } from "zustand";
import type { Workbench } from "@/application/workbench";
import type {
  ScenePreparationResult,
  SourceSelection,
  DerivationResult,
} from "@/application/contracts";
import { restoreArchive } from "@/application/import-archive";
import { downloadBlob, safeFilename } from "@/compute/export";
import { zipSync } from "fflate";
import type { GeometryContract, Scene } from "@/domain/scene";
import type { RgbImage } from "@/compute/codecs/image";
import { freshProcessing, processingSpecSchema, type ProcessingSpec } from "@/domain/processing";
import {
  diagnosticText,
  WorkbenchError,
  asWorkbenchError,
  diagnostic,
  type Diagnostic,
} from "@/domain/diagnostics";
import { DEFAULT_VIEW, type SelectedPoint, type ViewSpec } from "@/viewer/types";
import type { CameraPath, ExportJob, RenderSpec } from "@/domain/trajectory";

export type Mode = "inspect" | "compare" | "trajectory";
interface WorkbenchState {
  scenes: Scene[];
  scene: Scene | null;
  preparation: ScenePreparationResult | null;
  selection: SourceSelection | null;
  previews: {
    rgb: RgbImage;
    depth: import("@/domain/codec-registry").NumericArray | null;
    depthPreview: Uint8Array | null;
  } | null;
  mode: Mode;
  draft: ProcessingSpec;
  applied: ProcessingSpec | null;
  derivation: DerivationResult | null;
  selected: SelectedPoint[];
  view: ViewSpec;
  busy: string | null;
  error: string | null;
  diagnostics: Diagnostic[];
  progress: number | null;
  path: CameraPath | null;
  render: RenderSpec | null;
  trajectoryFrame: number;
  playing: boolean;
  exportJob: ExportJob | null;
  exportController: AbortController | null;
  boot(workbench: Workbench): Promise<void>;
  prepare(workbench: Workbench, selection: SourceSelection): Promise<void>;
  commit(workbench: Workbench, name: string, geometry: GeometryContract): Promise<void>;
  choose(scene: Scene, workbench?: Workbench): Promise<void>;
  setMode(mode: Mode): void;
  setDraft(draft: ProcessingSpec): void;
  setView(view: Partial<ViewSpec>): void;
  select(point: SelectedPoint): void;
  clearSelection(): void;
  derive(workbench: Workbench): Promise<void>;
  remove(workbench: Workbench): Promise<void>;
  archive(workbench: Workbench): Promise<void>;
  restore(workbench: Workbench, file: File): Promise<void>;
  cancel(workbench: Workbench): void;
  setTrajectory(path: CameraPath | null, render?: RenderSpec | null): void;
  setTrajectoryFrame(frame: number): void;
  setPlaying(playing: boolean): void;
  exportVideo(workbench: Workbench): Promise<void>;
}
let revision = 0;
export const useWorkbench = create<WorkbenchState>((set, get) => ({
  scenes: [],
  scene: null,
  preparation: null,
  selection: null,
  previews: null,
  mode: "inspect",
  draft: freshProcessing(),
  applied: null,
  derivation: null,
  selected: [],
  view: { ...DEFAULT_VIEW },
  busy: null,
  error: null,
  diagnostics: [],
  progress: null,
  path: null,
  render: null,
  trajectoryFrame: 0,
  playing: false,
  exportJob: null,
  exportController: null,
  async boot(workbench) {
    const scenes = await workbench.listScenes();
    set({ scenes });
    if (scenes[0]) await get().choose(scenes[0], workbench);
  },
  async prepare(workbench, selection) {
    const current = ++revision;
    set({ busy: "正在读取与解码", error: null, preparation: null, selection });
    try {
      const preparation = await workbench.prepare(selection);
      if (current === revision)
        set({
          preparation,
          diagnostics: preparation.diagnostics,
          previews: {
            rgb: preparation.rgb,
            depth: preparation.depth,
            depthPreview: preparation.depthPreview,
          },
          busy: null,
        });
    } catch (cause) {
      if (current === revision) set({ error: errorText(cause), busy: null });
    }
  },
  async commit(workbench, name, geometry) {
    const { preparation, selection } = get();
    if (!preparation || !selection) return;
    set({ busy: "正在保存 Scene", error: null });
    try {
      const scene = await workbench.commitScene(preparation, name, geometry, selection);
      const scenes = await workbench.listScenes();
      set({
        scenes,
        scene,
        preparation: null,
        selection: null,
        applied: null,
        derivation: null,
        draft: freshProcessing(),
        diagnostics: [],
        selected: [],
        path: null,
        busy: null,
      });
    } catch (cause) {
      set({ error: errorText(cause), busy: null });
    }
  },
  async choose(scene, workbench) {
    const current = ++revision;
    set({
      scene,
      preparation: null,
      selection: null,
      derivation: null,
      applied: null,
      draft: freshProcessing(),
      selected: [],
      path: null,
      error: null,
      diagnostics: [],
      previews: null,
    });
    if (!workbench) return;
    try {
      const { previews } = await workbench.sources(scene.sceneId);
      if (current !== revision) return;
      set({
        previews: { rgb: previews.rgb, depth: previews.depth, depthPreview: previews.depthPreview },
      });
      const processing = readApplied(scene.sceneId);
      if (processing) {
        const result = await workbench.readCachedDerivation(
          scene.sceneId,
          scene.sceneHash,
          processing,
        );
        if (result && current === revision)
          set({ derivation: result, applied: processing, draft: structuredClone(processing) });
      }
    } catch (cause) {
      if (current === revision) set({ error: errorText(cause) });
    }
  },
  setMode(mode) {
    set({ mode });
  },
  setDraft(draft) {
    set({ draft });
  },
  setView(patch) {
    set((state) => ({ view: { ...state.view, ...patch } }));
  },
  select(point) {
    set((state) => ({
      selected: [
        ...state.selected.filter((p) => p.pixelIndex !== point.pixelIndex).slice(-1),
        point,
      ],
    }));
  },
  clearSelection() {
    set({ selected: [] });
  },
  async derive(workbench) {
    const { scene, draft } = get();
    if (!scene) return;
    const current = ++revision;
    set({ busy: "正在生成确定性点云", error: null });
    try {
      const result = await workbench.derive(scene, draft);
      if (current === revision) {
        rememberApplied(scene.sceneId, draft);
        set({
          derivation: result,
          applied: structuredClone(draft),
          busy: null,
          selected: [],
          diagnostics: [],
        });
      }
    } catch (cause) {
      if (current === revision) set({ error: errorText(cause), busy: null });
    }
  },
  async remove(workbench) {
    const id = get().scene?.sceneId;
    if (!id) return;
    await workbench.removeScene(id);
    const scenes = await workbench.listScenes();
    set({
      scenes,
      scene: scenes[0] ?? null,
      derivation: null,
      applied: null,
      previews: null,
      path: null,
    });
  },
  async restore(workbench, file) {
    set({ busy: "正在验证并恢复 Archive", error: null });
    try {
      const scene = await restoreArchive(workbench, file);
      const scenes = await workbench.listScenes();
      set({ scenes, busy: null });
      await get().choose(scene, workbench);
    } catch (cause) {
      set({ busy: null, error: errorText(cause) });
    }
  },
  cancel(workbench) {
    const { exportController, exportJob } = get();
    exportController?.abort();
    if (exportJob?.status === "queued" || exportJob?.status === "running")
      set({ exportJob: { ...exportJob, status: "cancelling" } });
    workbench.dispose();
    set({ busy: null, progress: null, playing: false, exportController: null });
  },
  async archive(workbench) {
    const scene = get().scene;
    if (!scene) return;
    const blob = await workbench.archive(scene.sceneId, true);
    downloadBlob(blob, `${safeFilename(scene.name)}.rgbd.zip`);
  },
  setTrajectory(path, render = null) {
    set({ path, ...(render !== undefined ? { render } : {}), trajectoryFrame: 0, playing: false });
  },
  setTrajectoryFrame(frame) {
    set({ trajectoryFrame: frame });
  },
  setPlaying(playing) {
    set({ playing });
  },
  async exportVideo(workbench) {
    const { derivation, path, render } = get();
    if (!derivation || !path || !render) return;
    const controller = new AbortController();
    set({
      busy: "正在逐帧渲染与编码",
      progress: 0,
      error: null,
      exportJob: null,
      exportController: controller,
    });
    try {
      const blob = await workbench.renderVideo(
        derivation.cloud,
        path,
        render,
        controller.signal,
        (progress) => set({ progress }),
        (exportJob) => set({ exportJob }),
      );
      const extension =
        render.codec === "avc" ? "mp4" : render.codec === "vp9" ? "webm" : "frames.zip";
      const base = `${safeFilename(get().scene?.name ?? "rgbd-scene")}-${path.kind}`;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      if (render.codec === "png") {
        downloadBlob(blob, `${base}-${timestamp}.${extension}`);
      } else {
        const sidecar = await workbench.videoSidecar(derivation.cloud, path, render, blob);
        const bundle = zipSync(
          {
            [`${base}.${extension}`]: new Uint8Array(await blob.arrayBuffer()),
            [`${base}-export.json`]: new Uint8Array(await sidecar.arrayBuffer()),
          },
          { level: 0 },
        );
        downloadBlob(
          new Blob([bundle.slice().buffer], { type: "application/zip" }),
          `${base}-${timestamp}-export.zip`,
        );
      }
      set({ busy: null, progress: null, exportController: null });
    } catch (cause) {
      set({ error: errorText(cause), busy: null, progress: null, exportController: null });
    }
  },
}));
const APPLIED_STORAGE_KEY = "rgbd-workbench.applied.v2";
function readApplied(sceneId: string): ProcessingSpec | null {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(APPLIED_STORAGE_KEY) ?? "{}");
    if (typeof values !== "object" || values === null || Array.isArray(values)) return null;
    const value = (values as Record<string, unknown>)[sceneId];
    const parsed = processingSpecSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function rememberApplied(sceneId: string, processing: ProcessingSpec): void {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(APPLIED_STORAGE_KEY) ?? "{}");
    const current =
      typeof values === "object" && values !== null && !Array.isArray(values)
        ? (values as Record<string, unknown>)
        : {};
    current[sceneId] = processing;
    localStorage.setItem(APPLIED_STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* private mode/quota: in-memory Applied remains authoritative for this session */
  }
}
function errorText(cause: unknown): string {
  if (cause instanceof WorkbenchError) return cause.diagnostics.map(diagnosticText).join(" ");
  if (cause instanceof DOMException && cause.name === "AbortError") return "操作已取消。";
  return asWorkbenchError(cause, diagnostic("INTERNAL_ERROR", "fatal", "runtime.failure")).message;
}
