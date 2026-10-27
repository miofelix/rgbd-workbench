import type { ProcessingSpec } from "@/domain/processing";
import type { Scene } from "@/domain/scene";
import type { Diagnostic } from "@/domain/diagnostics";
import type { CameraPath, RenderSpec } from "@/domain/trajectory";
import type { RenderSources } from "../render/cpu-renderer";

export interface PrepareRequest {
  kind: "prepare";
  operationId: string;
  input: { rgb: File; depth: File; manifest?: File; name?: string };
}
export interface DeriveRequest {
  kind: "derive";
  operationId: string;
  scene: Scene;
  sources: { rgb: Blob; depth: Blob };
  processing: ProcessingSpec;
}
export interface VideoRequest {
  kind: "video";
  operationId: string;
  payload: ArrayBuffer;
  path: CameraPath;
  render: RenderSpec;
  sources?: RenderSources;
}
export interface CancelRequest {
  kind: "cancel";
  operationId: string;
}
export type WorkerRequest = PrepareRequest | DeriveRequest | VideoRequest | CancelRequest;
export type WorkerResponse =
  | { kind: "prepared"; operationId: string; result: unknown }
  | { kind: "derived"; operationId: string; payload: ArrayBuffer; cached: false }
  | { kind: "video"; operationId: string; payload: ArrayBuffer; mediaType: string }
  | { kind: "progress"; operationId: string; progress: number }
  | { kind: "failure"; operationId: string; diagnostics: Diagnostic[]; aborted: boolean };
export function operationId(): string {
  return crypto.randomUUID();
}
