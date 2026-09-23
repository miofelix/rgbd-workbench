import type {
  CapabilitiesResponse,
  ConfirmedImport,
  DerivationResponse,
  MetadataPayload,
  ProcessingSpec,
  ProbeResponse,
  SceneSummary,
} from "./types";

export class ApiError extends Error {
  diagnostics: import("./types").Diagnostic[];

  constructor(message: string, diagnostics: import("./types").Diagnostic[] = []) {
    super(message);
    this.name = "ApiError";
    this.diagnostics = diagnostics;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const payload = (await response.json().catch(() => ({}))) as {
    detail?: string;
    diagnostics?: import("./types").Diagnostic[];
  };
  if (!response.ok) {
    throw new ApiError(
      payload.detail ?? `Request failed (${response.status})`,
      payload.diagnostics ?? [],
    );
  }
  return payload as T;
}

export function probeImport(files: {
  rgb: File;
  depth: File;
  manifest?: File;
  signal?: AbortSignal;
}): Promise<ProbeResponse> {
  const body = new FormData();
  body.append("rgb", files.rgb);
  body.append("depth", files.depth);
  if (files.manifest) body.append("manifest", files.manifest);
  return request<ProbeResponse>("/api/v1/imports", { method: "POST", body, signal: files.signal });
}

export function confirmImport(
  importId: string,
  metadata: MetadataPayload,
  signal?: AbortSignal,
): Promise<ConfirmedImport> {
  return request<ConfirmedImport>(`/api/v1/imports/${encodeURIComponent(importId)}/metadata`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(metadata),
    signal,
  });
}

export function getImport(importId: string, signal?: AbortSignal): Promise<ConfirmedImport> {
  return request<ConfirmedImport>(`/api/v1/imports/${encodeURIComponent(importId)}`, { signal });
}

export function commitImport(importId: string, signal?: AbortSignal): Promise<{ schema_version: 1; scene: SceneSummary }> {
  return request<{ schema_version: 1; scene: SceneSummary }>(`/api/v1/imports/${encodeURIComponent(importId)}/commit`, {
    method: "POST",
    signal,
  });
}

export function listScenes(signal?: AbortSignal): Promise<{ schema_version: 1; scenes: SceneSummary[] }> {
  return request<{ schema_version: 1; scenes: SceneSummary[] }>("/api/v1/scenes", { signal });
}

export function getScene(sceneId: string, signal?: AbortSignal): Promise<{ schema_version: 1; scene: SceneSummary }> {
  return request<{ schema_version: 1; scene: SceneSummary }>(`/api/v1/scenes/${encodeURIComponent(sceneId)}`, { signal });
}

export function getCapabilities(signal?: AbortSignal): Promise<CapabilitiesResponse> {
  return request<CapabilitiesResponse>("/api/v1/capabilities", { signal });
}

export function scenePreviewUrl(sceneId: string, role: "rgb" | "depth"): string {
  return `/api/v1/scenes/${encodeURIComponent(sceneId)}/preview/${role}`;
}

export function createDerivation(
  sceneId: string,
  processing: ProcessingSpec,
  signal?: AbortSignal,
): Promise<DerivationResponse> {
  return request<DerivationResponse>(
    `/api/v1/scenes/${encodeURIComponent(sceneId)}/derivations`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(processing),
      signal,
    },
  );
}

export function getDerivation(
  derivationId: string,
  signal?: AbortSignal,
): Promise<DerivationResponse> {
  return request<DerivationResponse>(
    `/api/v1/derivations/${encodeURIComponent(derivationId)}`,
    { signal },
  );
}

export function derivationPointcloudUrl(derivationId: string): string {
  return `/api/v1/derivations/${encodeURIComponent(derivationId)}/pointcloud`;
}

export function derivationExportUrl(derivationId: string, format: "ply" | "json"): string {
  return `/api/v1/derivations/${encodeURIComponent(derivationId)}/export/${format}`;
}
