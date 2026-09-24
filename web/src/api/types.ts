export type ActiveMode = "inspect" | "compare" | "trajectory";

export type Severity = "info" | "warning" | "fatal";

export interface Diagnostic {
  code: string;
  severity: Severity;
  field: string | null;
  message: string;
  hint: string | null;
  capability: string | null;
}

export interface ProcessingSpec {
  schema_version: 1;
  roi: [number, number, number, number] | null;
  depth_min: number | null;
  depth_max: number | null;
  xyz_min: [number, number, number] | null;
  xyz_max: [number, number, number] | null;
  pixel_stride: number;
  max_points: number;
  voxel_size: number | null;
  knn_filter: { k: number; std_ratio: number } | null;
  knn_smooth: { k: number } | null;
}

export interface ArrayDescriptor {
  dtype: "float32" | "uint8" | "uint32";
  shape: number[];
  offset: number;
  nbytes: number;
}

export interface DerivationManifest {
  schema_version: 1;
  derivation_id: string;
  scene_id: string;
  scene_hash: string;
  derivation_key: string;
  processor_version: string;
  processing: ProcessingSpec;
  point_count: number;
  source_shape: [number, number];
  frame: string;
  unit: "m" | "unitless";
  representation: "z_depth" | "relative_z";
  bounds: { min: [number, number, number]; max: [number, number, number] };
  arrays: Record<"positions" | "colors" | "pixel_index", ArrayDescriptor>;
  diagnostics: Diagnostic[];
  created_at: string | null;
}

export interface DerivationResponse {
  schema_version: 1;
  cached: boolean;
  derivation: DerivationManifest;
  urls: { pointcloud: string; ply: string; json: string };
  diagnostics: Diagnostic[];
  capabilities: Record<string, boolean>;
}

export interface ViewSpec {
  projection: "perspective" | "orthographic";
  colorMode: "rgb" | "depth" | "mono" | "validity";
  pointSize: number;
  background: "dark" | "light";
}

export interface SelectedPoint {
  pixelIndex: number;
  position: [number, number, number];
  unit: "m" | "unitless";
}

export interface CapabilityReport {
  image_inspection: boolean;
  relative_pointcloud: boolean;
  metric_pointcloud: boolean;
  video_export: boolean;
}

export interface SourceSummary {
  source_id: string;
  role: "rgb" | "depth" | "manifest";
  filename: string;
  sha256_prefix: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  dtype: string | null;
}

export interface DepthSpec {
  representation: string;
  unit: string | null;
  scale_to_meter: number | null;
  invalid_values: number[];
  valid_min: number | null;
  valid_max: number | null;
}

export interface SceneSummary {
  schema_version: 1;
  scene_id: string;
  display_name: string;
  rgb: SourceSummary;
  depth: SourceSummary;
  depth_spec: DepthSpec | null;
  camera: {
    model?: string;
    width?: number;
    height?: number;
    fx?: number | null;
    fy?: number | null;
    cx?: number | null;
    cy?: number | null;
    distortion_model?: "none" | "unknown";
  } | null;
  alignment: { state?: string; method?: string | null } | null;
  frame_id: string;
  coordinate_convention: string;
  normalizer_version: string;
  adapter_versions: Record<string, string>;
  capabilities?: CapabilityReport;
  diagnostics?: Diagnostic[];
}

export interface ProbeCandidate {
  role: "rgb" | "depth" | "manifest";
  source: SourceSummary;
  metadata: Record<string, unknown>;
  diagnostics: Diagnostic[];
}

export interface ProbeResponse {
  schema_version: 1;
  import_id: string;
  candidates: Record<string, ProbeCandidate>;
  manifest: ProbeCandidate | null;
  scene?: SceneSummary | null;
  diagnostics: Diagnostic[];
  capabilities: CapabilityReport;
}

export interface ConfirmedImport extends ProbeResponse {
  scene?: SceneSummary | null;
}

export interface MetadataPayload {
  display_name?: string;
  representation?: string;
  unit?: string;
  scale_to_meter?: number;
  invalid_values?: number[];
  valid_min?: number;
  valid_max?: number;
  orientation_confirmed?: boolean;
  camera?: {
    model: "pinhole";
    width: number;
    height: number;
    fx: number;
    fy: number;
    cx: number;
    cy: number;
    distortion_model: "none" | "unknown";
  };
  alignment?: { state: "registered_to_rgb" | "unregistered" | "unknown" };
}

export interface CapabilitiesResponse {
  schema_version: 1;
  decoders: Record<string, boolean>;
  encoders: Record<string, boolean>;
  limits: Record<string, number>;
}
