import { z } from "zod";
import {
  cameraPathSchema,
  exportJobSchema,
  renderSpecSchema,
  type ExportJob,
} from "@/domain/trajectory";
import { derivationManifestSchema } from "@/domain/derivation";
import { frameCount } from "./trajectory/path";
import { trajectoryWarnings } from "./trajectory/validation";

export const frozenRenderInputSchema = z
  .object({
    cameraPath: cameraPathSchema,
    render: renderSpecSchema,
    derivation: derivationManifestSchema,
  })
  .strict();
export type FrozenRenderInput = z.infer<typeof frozenRenderInputSchema>;
export function freezeRenderInput(input: FrozenRenderInput): FrozenRenderInput {
  return structuredClone(frozenRenderInputSchema.parse(input));
}
export class ExportJobState {
  private value: ExportJob;
  constructor(input: FrozenRenderInput) {
    const warnings = trajectoryWarnings(input.cameraPath, input.render.fps);
    if (warnings.length) throw new Error(warnings[0]);
    this.value = exportJobSchema.parse({
      format: "rgbd-workbench/export-job",
      schemaVersion: 2,
      jobId: crypto.randomUUID(),
      derivationKey: input.derivation.derivationKey,
      cameraPath: input.cameraPath,
      render: input.render,
      status: "queued",
      frameCount: frameCount(input.cameraPath, input.render.fps),
      progress: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
  }
  snapshot(): ExportJob {
    return structuredClone(this.value);
  }
  start(): ExportJob {
    this.assert("queued");
    this.value.status = "running";
    return this.snapshot();
  }
  progress(progress: number): ExportJob {
    this.assert("running");
    this.value.progress = Math.min(1, Math.max(0, progress));
    return this.snapshot();
  }
  succeed(): ExportJob {
    this.assert("running");
    this.value.status = "succeeded";
    this.value.progress = 1;
    this.value.completedAt = new Date().toISOString();
    return this.snapshot();
  }
  fail(): ExportJob {
    this.assert("running");
    this.value.status = "failed";
    this.value.completedAt = new Date().toISOString();
    return this.snapshot();
  }
  cancel(): ExportJob {
    if (this.value.status === "queued") {
      this.value.status = "cancelled";
      this.value.completedAt = new Date().toISOString();
    } else if (this.value.status === "running") this.value.status = "cancelling";
    return this.snapshot();
  }
  cancelled(): ExportJob {
    if (this.value.status !== "cancelling") throw new Error("job was not cancelling");
    this.value.status = "cancelled";
    this.value.completedAt = new Date().toISOString();
    return this.snapshot();
  }
  interrupted(): ExportJob {
    this.assert("running");
    this.value.status = "interrupted";
    this.value.completedAt = new Date().toISOString();
    return this.snapshot();
  }
  private assert(status: ExportJob["status"]): void {
    if (this.value.status !== status)
      throw new Error(`invalid job transition ${this.value.status} -> ${status}`);
  }
}
export function recoverJob(job: ExportJob): ExportJob {
  const value = exportJobSchema.parse(job);
  if (value.status === "running" || value.status === "cancelling")
    return { ...value, status: "interrupted", completedAt: new Date().toISOString() };
  return value;
}
