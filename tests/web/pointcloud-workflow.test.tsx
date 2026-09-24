import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DerivationResponse,
  SceneSummary,
  SelectedPoint,
} from "../../web/src/api/types";
import { derivationResponse } from "./pointcloud-fixtures";

const apiMocks = vi.hoisted(() => ({
  createDerivation: vi.fn(),
}));

vi.mock("../../web/src/api/client", () => ({
  createDerivation: apiMocks.createDerivation,
  listScenes: vi.fn(async () => ({ schema_version: 1, scenes: [] })),
  scenePreviewUrl: (sceneId: string, role: string) =>
    `/preview/${sceneId}/${role}`,
}));

vi.mock("../../web/src/features/pointcloud/PointCloudViewer", () => ({
  PointCloudViewer: forwardRef(function MockViewer(
    {
      onPointSelected,
      selectedPoints = [],
      viewSpec,
      onViewSpecChange,
    }: {
      onPointSelected: (point: SelectedPoint) => void;
      selectedPoints: SelectedPoint[];
      viewSpec: { projection: string; colorMode: string; pointSize: number };
      onViewSpecChange: (patch: object) => void;
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      capturePng: () => "data:image/png;base64,fixture",
      resetView: vi.fn(),
      selectPixel: (pixelIndex: number) => ({
        pixelIndex: pixelIndex === 3 ? 1 : pixelIndex,
        position: pixelIndex === 3 ? [0, 0.3, 1.4] : [0, 0, 1],
        unit: "unitless",
      }),
    }));
    return (
      <div data-testid="pointcloud-canvas">
        <output data-testid="viewer-selected-pixels">
          {selectedPoints.map((point) => point.pixelIndex).join(",")}
        </output>
        <button
          type="button"
          aria-label="正交投影"
          onClick={() => onViewSpecChange({ projection: "orthographic" })}
        >
          正交
        </button>
        <label>
          着色
          <select
            aria-label="点云着色"
            value={viewSpec.colorMode}
            onChange={(event) =>
              onViewSpecChange({ colorMode: event.target.value })
            }
          >
            <option value="rgb">RGB</option>
            <option value="depth">深度</option>
          </select>
        </label>
        <label>
          点
          <input
            aria-label="点大小"
            type="range"
            value={viewSpec.pointSize}
            onChange={(event) =>
              onViewSpecChange({ pointSize: Number(event.target.value) })
            }
          />
        </label>
        <button
          type="button"
          onClick={() =>
            onPointSelected({
              pixelIndex: 0,
              position: [0, 0, 1],
              unit: "unitless",
            })
          }
        >
          选择测试点 A
        </button>
        <button
          type="button"
          onClick={() =>
            onPointSelected({
              pixelIndex: 1,
              position: [0, 0.3, 1.4],
              unit: "unitless",
            })
          }
        >
          选择测试点 B
        </button>
      </div>
    );
  }),
}));

import { SceneInspector } from "../../web/src/features/inspect/SceneInspector";
import { useWorkbenchStore } from "../../web/src/state/workbench";

function unitlessScene(): SceneSummary {
  return {
    schema_version: 1,
    scene_id: "relative-scene",
    display_name: "Relative fixture",
    rgb: {
      source_id: "rgb-1",
      role: "rgb",
      filename: "rgb.png",
      sha256_prefix: "a",
      size_bytes: 10,
      width: 2,
      height: 2,
      dtype: "uint8",
    },
    depth: {
      source_id: "depth-1",
      role: "depth",
      filename: "depth.npy",
      sha256_prefix: "b",
      size_bytes: 10,
      width: 2,
      height: 2,
      dtype: "float32",
    },
    depth_spec: {
      representation: "relative_z",
      unit: "unitless",
      scale_to_meter: null,
      invalid_values: [],
      valid_min: null,
      valid_max: null,
    },
    camera: { model: "pinhole", width: 2, height: 2 },
    alignment: { state: "registered_to_rgb" },
    frame_id: "camera",
    coordinate_convention: "x_right_y_down_z_forward",
    normalizer_version: "1",
    adapter_versions: { rgb: "1", depth: "1" },
    capabilities: {
      image_inspection: true,
      relative_pointcloud: true,
      metric_pointcloud: false,
      video_export: true,
    },
  };
}

function unitlessResponse(): DerivationResponse {
  const response = derivationResponse("relative-scene");
  return {
    ...response,
    derivation: {
      ...response.derivation,
      scene_id: "relative-scene",
      unit: "unitless",
      representation: "relative_z",
    },
    capabilities: { relative_pointcloud: true },
  };
}

describe("point-cloud analysis workflow", () => {
  beforeEach(() => {
    useWorkbenchStore.getState().reset();
    useWorkbenchStore.getState().selectScene(unitlessScene());
    apiMocks.createDerivation.mockReset();
    apiMocks.createDerivation.mockResolvedValue(unitlessResponse());
  });

  afterEach(() => cleanup());

  it("keeps draft changes dirty until Apply and labels a unitless measurement", async () => {
    const user = userEvent.setup();
    render(<SceneInspector scene={unitlessScene()} mode="inspect" />);

    fireEvent.change(screen.getByLabelText("像素步长"), {
      target: { value: "2" },
    });
    await user.click(screen.getByLabelText("离群过滤"));
    expect(screen.getByLabelText("离群 K")).toBeInTheDocument();
    expect(screen.getByLabelText("离群标准差比例")).toBeInTheDocument();
    expect(screen.getByText("有未应用更改")).toBeInTheDocument();
    expect(useWorkbenchStore.getState().appliedProcessing).toBeNull();

    await user.click(screen.getByRole("button", { name: /应用处理/ }));
    expect(await screen.findByTestId("pointcloud-canvas")).toBeInTheDocument();
    expect(useWorkbenchStore.getState().appliedProcessing?.pixel_stride).toBe(
      2,
    );

    await user.click(screen.getByRole("button", { name: "正交投影" }));
    await user.selectOptions(screen.getByLabelText("点云着色"), "depth");
    fireEvent.change(screen.getByLabelText("点大小"), {
      target: { value: "4" },
    });
    expect(useWorkbenchStore.getState().viewSpec).toMatchObject({
      projection: "orthographic",
      colorMode: "depth",
      pointSize: 4,
    });
    expect(apiMocks.createDerivation).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "选择测试点 A" }));
    await user.click(screen.getByRole("button", { name: "选择测试点 B" }));
    expect(screen.getByTestId("measurement-distance")).toHaveTextContent(
      "0.5000 unitless",
    );
    expect(
      screen.queryByRole("button", { name: /转换为米/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清除选点" }));
    expect(
      screen.queryByTestId("measurement-distance"),
    ).not.toBeInTheDocument();
  });

  it("renders one shared point-cloud viewer in compare mode with static exports", async () => {
    const user = userEvent.setup();
    await useWorkbenchStore
      .getState()
      .applyProcessing(async () => unitlessResponse());
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(<SceneInspector scene={unitlessScene()} mode="compare" />);

    expect(screen.getAllByTestId("pointcloud-canvas")).toHaveLength(1);
    expect(screen.getByText("RGB 输入")).toBeInTheDocument();
    expect(screen.getByText("深度输入")).toBeInTheDocument();
    expect(screen.getByText("深度摘要")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载 PLY" })).toHaveAttribute(
      "href",
      unitlessResponse().urls.ply,
    );
    expect(screen.getByRole("link", { name: "下载参数 JSON" })).toHaveAttribute(
      "href",
      unitlessResponse().urls.json,
    );
    await user.click(screen.getByRole("button", { name: "下载 PNG" }));
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("links image pixels and point-cloud selections in both directions", async () => {
    await useWorkbenchStore
      .getState()
      .applyProcessing(async () => unitlessResponse());
    render(<SceneInspector scene={unitlessScene()} mode="compare" />);
    const rgbImage = screen.getByRole("button", {
      name: "在 RGB 输入中选择像素",
    });
    vi.spyOn(rgbImage, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });

    fireEvent.click(rgbImage, { clientX: 75, clientY: 75 });

    expect(screen.getByTestId("viewer-selected-pixels")).toHaveTextContent("1");
    expect(screen.getAllByTestId("selection-marker-1")).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "选择测试点 A" }));

    expect(screen.getByTestId("viewer-selected-pixels")).toHaveTextContent(
      "1,0",
    );
    expect(screen.getAllByTestId("selection-marker-0")).toHaveLength(2);
    expect(screen.getByTestId("measurement-distance")).toBeVisible();
  });

  it("keeps geometry controls disabled when the Scene has no point-cloud capability", () => {
    const blocked = {
      ...unitlessScene(),
      capabilities: {
        image_inspection: true,
        relative_pointcloud: false,
        metric_pointcloud: false,
        video_export: false,
      },
    };
    useWorkbenchStore.getState().selectScene(blocked);

    render(<SceneInspector scene={blocked} mode="inspect" />);

    expect(screen.getByRole("button", { name: /应用处理/ })).toBeDisabled();
    expect(screen.getByText(/补全单位、内参和对齐/)).toBeInTheDocument();
  });
});
