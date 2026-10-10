import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImportWizard } from "../../web/src/features/import/ImportWizard";

const probe = {
  schema_version: 1,
  import_id: "imp-1",
  candidates: {
    rgb: {
      role: "rgb",
      source: {
        source_id: "r",
        role: "rgb",
        filename: "rgb.png",
        sha256_prefix: "a",
        size_bytes: 10,
        width: 2,
        height: 2,
        dtype: "uint8",
      },
      metadata: { format: "PNG", width: 2, height: 2, channels: 3 },
      diagnostics: [],
    },
    depth: {
      role: "depth",
      source: {
        source_id: "d",
        role: "depth",
        filename: "depth.npy",
        sha256_prefix: "b",
        size_bytes: 10,
        width: 2,
        height: 2,
        dtype: "uint16",
      },
      metadata: { format: "npy", shape: [2, 2], dtype: "uint16", unit: null },
      diagnostics: [
        {
          code: "DEPTH_SEMANTICS_REQUIRED",
          severity: "fatal",
          field: "depth",
          message: "Choose depth semantics.",
          hint: "Select a representation.",
          capability: "relative_pointcloud",
        },
      ],
    },
  },
  manifest: null,
  diagnostics: [],
  capabilities: {
    image_inspection: true,
    relative_pointcloud: false,
    metric_pointcloud: false,
    video_export: false,
  },
};

const apiMocks = vi.hoisted(() => ({
  probeImport: vi.fn(),
  confirmImport: vi.fn(),
  commitImport: vi.fn(),
  getImport: vi.fn(),
}));

vi.mock("../../web/src/api/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../web/src/api/client")>();
  return {
    ...actual,
    probeImport: apiMocks.probeImport,
    confirmImport: apiMocks.confirmImport,
    commitImport: apiMocks.commitImport,
    getImport: apiMocks.getImport,
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
    apiMocks.getImport.mockReset();
    apiMocks.probeImport.mockResolvedValue(probe);
    apiMocks.confirmImport.mockResolvedValue(confirmedProbe);
    apiMocks.commitImport.mockResolvedValue({
      schema_version: 1,
      scene: confirmedProbe.scene,
    });
    apiMocks.getImport.mockResolvedValue(probe);
  });

  it("shows probe diagnostics and explicit representation/unit controls", async () => {
    render(<ImportWizard onCommitted={vi.fn()} />);
    const inputs = [
      screen.getByLabelText("RGB 图像文件"),
      screen.getByLabelText("深度数据文件"),
    ];
    fireEvent.change(inputs[0], {
      target: { files: [new File(["rgb"], "rgb.png", { type: "image/png" })] },
    });
    const depthInput = inputs[1];
    fireEvent.change(depthInput, {
      target: {
        files: [
          new File(["depth"], "depth.npy", {
            type: "application/octet-stream",
          }),
        ],
      },
    });

    await waitFor(() =>
      expect(screen.getByText("DEPTH_SEMANTICS_REQUIRED")).toBeInTheDocument(),
    );
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
      target: {
        files: [
          new File(["depth"], "metric_depth.npy", {
            type: "application/octet-stream",
          }),
        ],
      },
    });
    await screen.findByText("DEPTH_SEMANTICS_REQUIRED");

    await user.selectOptions(screen.getByLabelText("深度表示"), "relative_z");
    expect(screen.getByLabelText("单位")).toHaveValue("unitless");
    expect(screen.getByRole("button", { name: "确认参数" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "确认参数" }));

    await waitFor(() =>
      expect(apiMocks.confirmImport).toHaveBeenCalledWith(
        "imp-1",
        expect.objectContaining({
          representation: "relative_z",
          unit: "unitless",
        }),
        expect.any(AbortSignal),
      ),
    );
    expect(
      screen.queryByText("DEPTH_SEMANTICS_REQUIRED"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存 Scene" })).toBeEnabled();
  });

  it("re-probes when a manifest is selected after the RGB-D pair", async () => {
    render(<ImportWizard onCommitted={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("RGB 图像文件"), {
      target: { files: [new File(["rgb"], "rgb.png", { type: "image/png" })] },
    });
    fireEvent.change(screen.getByLabelText("深度数据文件"), {
      target: {
        files: [
          new File(["depth"], "metric_depth.npy", {
            type: "application/octet-stream",
          }),
        ],
      },
    });
    await screen.findByText("DEPTH_SEMANTICS_REQUIRED");
    const manifest = new File(["{}"], "scene.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("可选 manifest 文件"), {
      target: { files: [manifest] },
    });

    await waitFor(() => expect(apiMocks.probeImport).toHaveBeenCalledTimes(2));
    expect(apiMocks.probeImport.mock.calls[1][0].manifest).toBe(manifest);
  });

  it("shows selected filenames and re-probes without a removed manifest", async () => {
    const user = userEvent.setup();
    render(<ImportWizard onCommitted={vi.fn()} />);
    uploadPair();
    await screen.findByText("DEPTH_SEMANTICS_REQUIRED");
    const manifest = new File(["{}"], "scene.json", {
      type: "application/json",
    });
    await user.upload(screen.getByLabelText("可选 manifest 文件"), manifest);

    expect(screen.getByText("rgb.png")).toBeInTheDocument();
    expect(screen.getByText("depth.npy")).toBeInTheDocument();
    expect(screen.getByText("scene.json")).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.probeImport).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "移除 manifest" }));

    await waitFor(() => expect(apiMocks.probeImport).toHaveBeenCalledTimes(3));
    expect(apiMocks.probeImport.mock.calls[2][0].manifest).toBeUndefined();
    expect(screen.queryByText("scene.json")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "移除 manifest" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("可选 manifest 文件")).toHaveValue("");
  });

  it("retries a failed probe using the selected files", async () => {
    const user = userEvent.setup();
    apiMocks.probeImport.mockRejectedValueOnce(new Error("探测服务暂时不可用"));
    render(<ImportWizard onCommitted={vi.fn()} />);
    uploadPair();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "探测服务暂时不可用",
    );
    expect(screen.getByText("rgb.png")).toBeInTheDocument();
    expect(screen.getByText("depth.npy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新探测" }));

    await screen.findByText("DEPTH_SEMANTICS_REQUIRED");
    expect(apiMocks.probeImport).toHaveBeenCalledTimes(2);
    expect(apiMocks.probeImport.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        rgb: expect.objectContaining({ name: "rgb.png" }),
        depth: expect.objectContaining({ name: "depth.npy" }),
      }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "重新探测" }),
    ).not.toBeInTheDocument();
  });

  it("keeps geometry visible when camera metadata is missing and groups optional depth fields", async () => {
    render(<ImportWizard onCommitted={vi.fn()} />);
    uploadPair();
    await screen.findByText("DEPTH_SEMANTICS_REQUIRED");

    expect(screen.getByText("几何信息").closest("details")).toHaveAttribute(
      "open",
    );
    expect(
      screen.getByText("更多深度设置").closest("details"),
    ).not.toHaveAttribute("open");
    expect(screen.getByLabelText("对齐状态").closest("details")).toBe(
      screen.getByText("几何信息").closest("details"),
    );
    expect(screen.getByLabelText("深度无效值").closest("details")).toBe(
      screen.getByText("更多深度设置").closest("details"),
    );
    expect(screen.getByLabelText("深度表示")).toHaveValue("");
    expect(screen.getByLabelText("单位")).toHaveValue("");
    expect(screen.getByLabelText("对齐状态")).toHaveValue("unknown");
    expect(screen.getByLabelText("相机 fx")).toHaveValue(0);
  });

  it("shows restored filenames and collapses complete camera metadata", async () => {
    const restored = {
      ...confirmedProbe,
      manifest: {
        ...probe.candidates.rgb,
        role: "manifest",
        source: {
          ...probe.candidates.rgb.source,
          filename: "camera.json",
          role: "manifest",
        },
      },
      scene: {
        ...confirmedProbe.scene,
        camera: {
          model: "pinhole",
          width: 2,
          height: 2,
          fx: 5,
          fy: 5,
          cx: 1,
          cy: 1,
          distortion_model: "none",
        },
      },
    };
    apiMocks.getImport.mockResolvedValue(restored);
    render(<ImportWizard initialImportId="imp-1" onCommitted={vi.fn()} />);

    await screen.findByText("camera.json");
    expect(screen.getByText("rgb.png")).toBeInTheDocument();
    expect(screen.getByText("depth.npy")).toBeInTheDocument();
    expect(screen.getByText("几何信息").closest("details")).not.toHaveAttribute(
      "open",
    );
    expect(screen.getByLabelText("相机 fx")).toHaveValue(5);
    expect(screen.getByLabelText("对齐状态")).toHaveValue("unknown");
  });

  it("keeps file controls in the keyboard tab order", async () => {
    const user = userEvent.setup();
    render(<ImportWizard onCommitted={vi.fn()} />);
    await user.tab();
    expect(screen.getByLabelText("RGB 图像文件")).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("深度数据文件")).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("可选 manifest 文件")).toHaveFocus();
  });

  it("ignores a stale probe after files change", async () => {
    let resolveFirst: (value: typeof probe) => void = () => undefined;
    apiMocks.probeImport.mockImplementationOnce(
      () =>
        new Promise<typeof probe>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const onProbed = vi.fn();
    render(<ImportWizard onCommitted={vi.fn()} onProbed={onProbed} />);
    uploadPair();
    const firstSignal = apiMocks.probeImport.mock.calls[0][0]
      .signal as AbortSignal;
    const newProbe = { ...probe, import_id: "imp-new" };
    apiMocks.probeImport.mockResolvedValue(newProbe);
    fireEvent.change(screen.getByLabelText("深度数据文件"), {
      target: {
        files: [
          new File(["new depth"], "new_depth.npy", {
            type: "application/octet-stream",
          }),
        ],
      },
    });

    await waitFor(() => expect(onProbed).toHaveBeenCalledWith(newProbe));
    expect(firstSignal.aborted).toBe(true);
    await act(async () => resolveFirst(probe));
    expect(onProbed).toHaveBeenCalledTimes(1);
    expect(screen.getByText("new_depth.npy")).toBeInTheDocument();
  });

  it("aborts an unfinished probe on unmount and ignores late responses", async () => {
    let resolveProbe: (value: typeof probe) => void = () => undefined;
    apiMocks.probeImport.mockImplementation(
      () =>
        new Promise<typeof probe>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const onProbed = vi.fn();
    const { unmount } = render(
      <ImportWizard onCommitted={vi.fn()} onProbed={onProbed} />,
    );
    uploadPair();
    const signal = apiMocks.probeImport.mock.calls[0][0].signal as AbortSignal;

    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => resolveProbe(probe));
    expect(onProbed).not.toHaveBeenCalled();
  });

  it("cancels the active request when the import form is dismissed", async () => {
    const user = userEvent.setup();
    apiMocks.probeImport.mockImplementation(() => new Promise(() => undefined));
    const onCancel = vi.fn();
    render(<ImportWizard onCommitted={vi.fn()} onCancel={onCancel} />);
    uploadPair();
    const signal = apiMocks.probeImport.mock.calls[0][0].signal as AbortSignal;

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(signal.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls back after saving and clears the file selection for another import", async () => {
    const user = userEvent.setup();
    const onCommitted = vi.fn();
    render(<ImportWizard onCommitted={onCommitted} />);
    await user.upload(
      screen.getByLabelText("RGB 图像文件"),
      new File(["rgb"], "rgb.png", { type: "image/png" }),
    );
    await user.upload(
      screen.getByLabelText("深度数据文件"),
      new File(["depth"], "depth.npy", { type: "application/octet-stream" }),
    );
    await screen.findByText("DEPTH_SEMANTICS_REQUIRED");
    await user.click(screen.getByRole("button", { name: "保存 Scene" }));

    await waitFor(() =>
      expect(onCommitted).toHaveBeenCalledWith(confirmedProbe.scene),
    );
    expect(screen.getByLabelText("RGB 图像文件")).toHaveValue("");
    expect(screen.getByLabelText("深度数据文件")).toHaveValue("");
    expect(screen.queryByText("rgb.png")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "保存 Scene" }),
    ).not.toBeInTheDocument();
  });
  it("keeps explicit units and custom scale mutually exclusive", async () => {
    const user = userEvent.setup();
    render(<ImportWizard onCommitted={vi.fn()} initialImportId="imp-1" />);
    await screen.findByLabelText("深度表示");
    await user.selectOptions(screen.getByLabelText("深度表示"), "z_depth");
    await user.selectOptions(screen.getByLabelText("单位"), "custom");
    expect(screen.getByRole("button", { name: "确认参数" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("米制比例"), {
      target: { value: "0.001" },
    });
    await user.click(screen.getByRole("button", { name: "确认参数" }));
    expect(apiMocks.confirmImport).toHaveBeenCalledWith(
      "imp-1",
      expect.objectContaining({ unit: undefined, scale_to_meter: 0.001 }),
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "确认参数" }),
      ).not.toBeDisabled(),
    );
    await user.selectOptions(screen.getByLabelText("深度表示"), "z_depth");
    await user.selectOptions(screen.getByLabelText("单位"), "mm");
    expect(screen.queryByLabelText("米制比例")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认参数" }));
    expect(apiMocks.confirmImport).toHaveBeenLastCalledWith(
      "imp-1",
      expect.objectContaining({ unit: "mm", scale_to_meter: undefined }),
      expect.any(AbortSignal),
    );
  });
});

function uploadPair(): void {
  fireEvent.change(screen.getByLabelText("RGB 图像文件"), {
    target: { files: [new File(["rgb"], "rgb.png", { type: "image/png" })] },
  });
  fireEvent.change(screen.getByLabelText("深度数据文件"), {
    target: {
      files: [
        new File(["depth"], "depth.npy", { type: "application/octet-stream" }),
      ],
    },
  });
}
