import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const apiMocks = vi.hoisted(() => ({
  probeImport: vi.fn(),
  confirmImport: vi.fn(),
  commitImport: vi.fn(),
}));

vi.mock("../../web/src/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../web/src/api/client")>();
  return {
    ...actual,
    probeImport: apiMocks.probeImport,
    confirmImport: apiMocks.confirmImport,
    commitImport: apiMocks.commitImport,
  };
});

const confirmedProbe = {
  ...probe,
  scene: {
    schema_version: 1,
    scene_id: "scene-1",
    display_name: "Untitled Scene",
    rgb: probe.candidates.rgb.source,
    depth: probe.candidates.depth.source,
    depth_spec: {
      representation: "relative_z",
      unit: "unitless",
      scale_to_meter: null,
      invalid_values: [],
      valid_min: null,
      valid_max: null,
    },
    camera: null,
    alignment: null,
    frame_id: "camera",
    coordinate_convention: "x_right_y_down_z_forward",
    normalizer_version: "1",
    adapter_versions: { rgb: "1", depth: "1" },
    capabilities: { ...probe.capabilities, relative_pointcloud: false },
  },
  diagnostics: [],
  capabilities: { ...probe.capabilities, relative_pointcloud: false },
};

describe("ImportWizard", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    apiMocks.probeImport.mockReset();
    apiMocks.confirmImport.mockReset();
    apiMocks.commitImport.mockReset();
    apiMocks.probeImport.mockResolvedValue(probe);
    apiMocks.confirmImport.mockResolvedValue(confirmedProbe);
    apiMocks.commitImport.mockResolvedValue({ schema_version: 1, scene: confirmedProbe.scene });
  });

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
    expect(screen.getByRole("button", { name: "确认参数" })).toBeDisabled();
    expect(screen.getByText(/请选择深度表示/)).toBeInTheDocument();
  });

  it("requires explicit compatible semantics and clears the resolved diagnostic", async () => {
    const user = userEvent.setup();
    render(<ImportWizard onCommitted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("RGB 图像文件"), {
      target: { files: [new File(["rgb"], "rgb.png", { type: "image/png" })] },
    });
    fireEvent.change(screen.getByLabelText("深度数据文件"), {
      target: { files: [new File(["depth"], "metric_depth.npy", { type: "application/octet-stream" })] },
    });
    await screen.findByText("DEPTH_SEMANTICS_REQUIRED");

    await user.selectOptions(screen.getByLabelText("深度表示"), "relative_z");
    expect(screen.getByLabelText("单位")).toHaveValue("unitless");
    expect(screen.getByRole("button", { name: "确认参数" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "确认参数" }));

    await waitFor(() => expect(apiMocks.confirmImport).toHaveBeenCalledWith(
      "imp-1",
      expect.objectContaining({ representation: "relative_z", unit: "unitless" }),
      expect.any(AbortSignal),
    ));
    expect(screen.queryByText("DEPTH_SEMANTICS_REQUIRED")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存 Scene" })).toBeEnabled();
  });

  it("re-probes when a manifest is selected after the RGB-D pair", async () => {
    render(<ImportWizard onCommitted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("RGB 图像文件"), {
      target: { files: [new File(["rgb"], "rgb.png", { type: "image/png" })] },
    });
    fireEvent.change(screen.getByLabelText("深度数据文件"), {
      target: { files: [new File(["depth"], "metric_depth.npy", { type: "application/octet-stream" })] },
    });
    await screen.findByText("DEPTH_SEMANTICS_REQUIRED");
    const manifest = new File(["{}"], "scene.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("可选 manifest 文件"), {
      target: { files: [manifest] },
    });

    await waitFor(() => expect(apiMocks.probeImport).toHaveBeenCalledTimes(2));
    expect(apiMocks.probeImport.mock.calls[1][0].manifest).toBe(manifest);
  });
});
