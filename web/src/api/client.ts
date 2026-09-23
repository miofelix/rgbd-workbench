import type {
  CapabilitiesResponse,
  ConfirmedImport,
  MetadataPayload,
  ProbeResponse,
  SceneSummary,
} from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const payload = (await response.json().catch(() => ({}))) as { detail?: string };
  if (!response.ok) {
    throw new Error(payload.detail ?? `Request failed (${response.status})`);
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
