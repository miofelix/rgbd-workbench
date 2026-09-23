import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImportWizard } from "../../web/src/features/import/ImportWizard";

const probe = {
  schema_version: 1,
  import_id: "imp-1",
  candidates: {
    rgb: { role: "rgb", source: { source_id: "r", role: "rgb", filename: "rgb.png", sha256_prefix: "a", size_bytes: 10, width: 2, height: 2, dtype: "uint8" }, metadata: { format: "PNG", width: 2, height: 2, channels: 3 }, diagnostics: [] },
    depth: { role: "depth", source: { source_id: "d", role: "depth", filename: "depth.npy", sha256_prefix: "b", size_bytes: 10, width: 2, height: 2, dtype: "uint16" }, metadata: { format: "npy", shape: [2, 2], dtype: "uint16", unit: null }, diagnostics: [{ code: "DEPTH_SEMANTICS_REQUIRED", severity: "fatal", field: "depth", message: "Choose depth semantics.", hint: "Select a representation.", capability: "relative_pointcloud" }] },
  },
  manifest: null,
  diagnostics: [],
  capabilities: { image_inspection: true, relative_pointcloud: false, metric_pointcloud: false, video_export: false },
};

vi.mock("../../web/src/api/client", () => ({
  probeImport: vi.fn(async () => probe),
  confirmImport: vi.fn(async () => ({ ...probe, capabilities: { ...probe.capabilities, relative_pointcloud: true } })),
  commitImport: vi.fn(async () => ({ schema_version: 1, scene: {} })),
}));

describe("ImportWizard", () => {
  it("shows probe diagnostics and explicit representation/unit controls", async () => {
    render(<ImportWizard onCommitted={vi.fn()} />);
    const inputs = [screen.getByLabelText("RGB 图像文件"), screen.getByLabelText("深度数据文件")];
    fireEvent.change(inputs[0], { target: { files: [new File(["rgb"], "rgb.png", { type: "image/png" })] } });
    const depthInput = inputs[1];
    fireEvent.change(depthInput, { target: { files: [new File(["depth"], "depth.npy", { type: "application/octet-stream" })] } });

    await waitFor(() => expect(screen.getByText("DEPTH_SEMANTICS_REQUIRED")).toBeInTheDocument());
    expect(screen.getByLabelText(/深度表示/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/单位/i)).toBeInTheDocument();
    expect(screen.queryByText(/\/private\//)).not.toBeInTheDocument();
  });
});
