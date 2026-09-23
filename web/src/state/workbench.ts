import { create } from "zustand";

import { createDerivation, listScenes } from "../api/client";
import type {
  ActiveMode,
  DerivationManifest,
  DerivationResponse,
  Diagnostic,
  MetadataPayload,
  ProcessingSpec,
  ProbeResponse,
  SceneSummary,
  SelectedPoint,
  ViewSpec,
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
  draftProcessing: ProcessingSpec;
  appliedProcessing: ProcessingSpec | null;
  appliedDerivation: DerivationManifest | null;
  appliedDerivationUrls: DerivationResponse["urls"] | null;
  derivationCached: boolean;
  viewSpec: ViewSpec;
  selectedPoints: SelectedPoint[];
  derivationBusy: boolean;
  derivationRequestRevision: number;
  reset: () => void;
  setMode: (mode: ActiveMode) => void;
  selectScene: (scene: SceneSummary | null) => void;
  setImportSession: (session: ProbeResponse | null) => void;
  setDraftMetadata: (metadata: MetadataPayload) => void;
  setDraftProcessing: (processing: ProcessingSpec) => void;
  setViewSpec: (view: Partial<ViewSpec>) => void;
  selectPoint: (point: SelectedPoint) => void;
  clearSelectedPoints: () => void;
  clearDerivation: () => void;
  applyProcessing: (loader?: DerivationLoader) => Promise<void>;
  loadScenes: (loader?: SceneLoader) => Promise<void>;
}

type SceneLoader = () => Promise<{ scenes: SceneSummary[] } | SceneSummary[]>;
type DerivationLoader = (
  sceneId: string,
  processing: ProcessingSpec,
  signal: AbortSignal,
) => Promise<DerivationResponse>;

export const DEFAULT_PROCESSING: ProcessingSpec = {
  schema_version: 1,
  roi: null,
  depth_min: null,
  depth_max: null,
  xyz_min: null,
  xyz_max: null,
  pixel_stride: 1,
  max_points: 2_000_000,
  voxel_size: null,
  knn_filter: null,
  knn_smooth: null,
};

const DEFAULT_VIEW: ViewSpec = {
  projection: "perspective",
  colorMode: "rgb",
  pointSize: 2,
  background: "dark",
};

let activeDerivationRequest: AbortController | null = null;

const freshProcessing = (): ProcessingSpec => ({ ...DEFAULT_PROCESSING });

const initialState = {
  activeSceneId: null,
  activeMode: "inspect" as ActiveMode,
  scenes: [] as SceneSummary[],
  appliedScene: null as SceneSummary | null,
  importSession: null as ProbeResponse | null,
  draftMetadata: {} as MetadataPayload,
  diagnostics: [] as Diagnostic[],
  requestRevision: 0,
  draftProcessing: freshProcessing(),
  appliedProcessing: null as ProcessingSpec | null,
  appliedDerivation: null as DerivationManifest | null,
  appliedDerivationUrls: null as DerivationResponse["urls"] | null,
  derivationCached: false,
  viewSpec: { ...DEFAULT_VIEW },
  selectedPoints: [] as SelectedPoint[],
  derivationBusy: false,
  derivationRequestRevision: 0,
};

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  ...initialState,
  reset: () => {
    activeDerivationRequest?.abort();
    activeDerivationRequest = null;
    set({
      ...initialState,
      draftProcessing: freshProcessing(),
      viewSpec: { ...DEFAULT_VIEW },
      scenes: [],
      diagnostics: [],
      selectedPoints: [],
    });
  },
  setMode: (activeMode) => set({ activeMode }),
  selectScene: (scene) => {
    activeDerivationRequest?.abort();
    activeDerivationRequest = null;
    set((state) => ({
      activeSceneId: scene?.scene_id ?? null,
      appliedScene: scene,
      diagnostics: [],
      requestRevision: state.requestRevision + 1,
      derivationRequestRevision: state.derivationRequestRevision + 1,
      draftProcessing: freshProcessing(),
      appliedProcessing: null,
      appliedDerivation: null,
      appliedDerivationUrls: null,
      derivationCached: false,
      selectedPoints: [],
      derivationBusy: false,
    }));
  },
  setImportSession: (importSession) =>
    set({
      importSession,
      diagnostics: importSession?.diagnostics ?? [],
      draftMetadata: {},
    }),
  setDraftMetadata: (draftMetadata) => set({ draftMetadata }),
  setDraftProcessing: (draftProcessing) => set({ draftProcessing }),
  setViewSpec: (patch) =>
    set((state) => ({ viewSpec: { ...state.viewSpec, ...patch } })),
  selectPoint: (point) =>
    set((state) => {
      const existing = state.selectedPoints.findIndex(
        (item) => item.pixelIndex === point.pixelIndex,
      );
      if (existing >= 0) {
        const selectedPoints = [...state.selectedPoints];
        selectedPoints[existing] = point;
        return { selectedPoints };
      }
      return { selectedPoints: [...state.selectedPoints.slice(-1), point] };
    }),
  clearSelectedPoints: () => set({ selectedPoints: [] }),
  clearDerivation: () => {
    activeDerivationRequest?.abort();
    activeDerivationRequest = null;
    set((state) => ({
      appliedProcessing: null,
      appliedDerivation: null,
      appliedDerivationUrls: null,
      derivationCached: false,
      selectedPoints: [],
      derivationBusy: false,
      derivationRequestRevision: state.derivationRequestRevision + 1,
    }));
  },
  applyProcessing: async (loader: DerivationLoader = createDerivation) => {
    const sceneId = get().activeSceneId;
    if (sceneId === null) return;
    activeDerivationRequest?.abort();
    const controller = new AbortController();
    activeDerivationRequest = controller;
    const revision = get().derivationRequestRevision + 1;
    const processing = { ...get().draftProcessing };
    set({
      derivationBusy: true,
      derivationRequestRevision: revision,
      diagnostics: [],
    });
    try {
      const response = await loader(sceneId, processing, controller.signal);
      if (
        controller.signal.aborted ||
        get().derivationRequestRevision !== revision ||
        get().activeSceneId !== sceneId
      )
        return;
      set({
        appliedProcessing: processing,
        appliedDerivation: response.derivation,
        appliedDerivationUrls: response.urls,
        derivationCached: response.cached,
        diagnostics: response.diagnostics,
      });
    } catch (cause) {
      if (
        controller.signal.aborted ||
        get().derivationRequestRevision !== revision ||
        get().activeSceneId !== sceneId
      )
        return;
      const diagnostics =
        typeof cause === "object" && cause !== null && "diagnostics" in cause
          ? ((cause as { diagnostics?: Diagnostic[] }).diagnostics ?? [])
          : [];
      set({ diagnostics });
    } finally {
      if (
        get().derivationRequestRevision === revision &&
        get().activeSceneId === sceneId
      ) {
        set({ derivationBusy: false });
        if (activeDerivationRequest === controller)
          activeDerivationRequest = null;
      }
    }
  },
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
