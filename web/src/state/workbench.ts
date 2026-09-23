import { create } from "zustand";

import { listScenes } from "../api/client";
import type {
  ActiveMode,
  Diagnostic,
  MetadataPayload,
  ProbeResponse,
  SceneSummary,
} from "../api/types";

interface WorkbenchState {
  activeSceneId: string | null;
  activeMode: ActiveMode;
  scenes: SceneSummary[];
  appliedScene: SceneSummary | null;
  importSession: ProbeResponse | null;
  draftMetadata: MetadataPayload;
  diagnostics: Diagnostic[];
  requestRevision: number;
  reset: () => void;
  setMode: (mode: ActiveMode) => void;
  selectScene: (scene: SceneSummary | null) => void;
  setImportSession: (session: ProbeResponse | null) => void;
  setDraftMetadata: (metadata: MetadataPayload) => void;
  loadScenes: (loader?: SceneLoader) => Promise<void>;
}

type SceneLoader = () => Promise<{ scenes: SceneSummary[] } | SceneSummary[]>;

const initialState = {
  activeSceneId: null,
  activeMode: "inspect" as ActiveMode,
  scenes: [] as SceneSummary[],
  appliedScene: null as SceneSummary | null,
  importSession: null as ProbeResponse | null,
  draftMetadata: {} as MetadataPayload,
  diagnostics: [] as Diagnostic[],
  requestRevision: 0,
};

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  ...initialState,
  reset: () => set({ ...initialState }),
  setMode: (activeMode) => set({ activeMode }),
  selectScene: (scene) =>
    set((state) => ({
      activeSceneId: scene?.scene_id ?? null,
      appliedScene: scene,
      diagnostics: [],
      requestRevision: state.requestRevision + 1,
    })),
  setImportSession: (importSession) =>
    set({
      importSession,
      diagnostics: importSession?.diagnostics ?? [],
      draftMetadata: {},
    }),
  setDraftMetadata: (draftMetadata) => set({ draftMetadata }),
  loadScenes: async (loader: SceneLoader = listScenes) => {
    const revision = get().requestRevision + 1;
    set({ requestRevision: revision });
    const result = await loader();
    if (get().requestRevision !== revision) return;
    const scenes = Array.isArray(result) ? result : result.scenes;
    set({ scenes });
    if (scenes.length > 0 && get().activeSceneId === null) {
      get().selectScene(scenes[0]);
    }
  },
}));
