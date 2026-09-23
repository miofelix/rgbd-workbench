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
  camera: { model?: string; width?: number; height?: number } | null;
  alignment: { state?: string } | null;
  frame_id: string;
  coordinate_convention: string;
  normalizer_version: string;
  adapter_versions: Record<string, string>;
  capabilities?: CapabilityReport;
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
  diagnostics: Diagnostic[];
  capabilities: CapabilityReport;
}

export interface ConfirmedImport extends ProbeResponse {
  scene: SceneSummary;
}

export interface MetadataPayload {
  display_name?: string;
  representation?: string;
  unit?: string;
  scale_to_meter?: number;
  invalid_values?: number[];
  valid_min?: number;
  valid_max?: number;
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
