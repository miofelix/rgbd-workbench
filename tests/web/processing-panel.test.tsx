import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProcessingSpec } from "../../web/src/api/types";
import { ProcessingPanel } from "../../web/src/features/pointcloud/ProcessingPanel";
import {
  DEFAULT_PROCESSING,
  useWorkbenchStore,
} from "../../web/src/state/workbench";
import { derivationResponse } from "./pointcloud-fixtures";

const apiMocks = vi.hoisted(() => ({ createDerivation: vi.fn() }));

vi.mock("../../web/src/api/client", () => ({
  createDerivation: apiMocks.createDerivation,
  listScenes: vi.fn(async () => ({ scenes: [] })),
}));

function panel(enabled = true): React.JSX.Element {
  return (
    <ProcessingPanel
      enabled={enabled}
      sourceWidth={640}
      sourceHeight={480}
      unit="unitless"
    />
  );
}

describe("processing controls", () => {
  beforeEach(() => {
    useWorkbenchStore.getState().reset();
    useWorkbenchStore.setState({ activeSceneId: "scene-1" });
    apiMocks.createDerivation.mockReset();
    apiMocks.createDerivation.mockImplementation(
      async (_, processing: ProcessingSpec) => {
        const response = derivationResponse();
        return {
          ...response,
          derivation: { ...response.derivation, processing },
        };
      },
    );
  });

  afterEach(cleanup);

  it("starts with four basic controls and reveals optional processing on demand", async () => {
    const user = userEvent.setup();
    const { container } = render(panel());

    expect(screen.getByText("待生成点云")).toBeInTheDocument();
    expect(screen.queryByText("有未应用更改")).not.toBeInTheDocument();
    expect(
      container.querySelectorAll(".processing-fields:first-child input"),
    ).toHaveLength(4);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText("体素尺寸")).not.toBeVisible();
    expect(screen.getByText("深度下限 (unitless)")).toBeInTheDocument();

    await user.click(screen.getByText("高级处理"));
    expect(screen.getByLabelText("体素尺寸")).toBeVisible();
    expect(screen.getByLabelText("离群过滤")).toBeVisible();
    expect(screen.getByText(/空间参数单位：unitless/)).toBeVisible();
  });

  it("blocks invalid drafts and applies only after they are corrected", async () => {
    const user = userEvent.setup();
    render(panel());
    const apply = screen.getByRole("button", { name: "应用处理" });

    fireEvent.change(screen.getByLabelText("像素步长"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("深度下限"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("深度上限"), {
      target: { value: "2" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "深度上限不能小于深度下限",
    );
    expect(screen.getByLabelText("像素步长")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(apply).toBeDisabled();
    await user.click(apply);
    expect(apiMocks.createDerivation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("像素步长"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("深度上限"), {
      target: { value: "4" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(apply);
    expect(apiMocks.createDerivation).toHaveBeenCalledOnce();
    expect(useWorkbenchStore.getState().appliedProcessing).toMatchObject({
      pixel_stride: 2,
      depth_min: 3,
      depth_max: 4,
    });
    expect(screen.getByText("已应用")).toBeInTheDocument();
    expect(apply).toBeDisabled();
  });

  it("restores applied or default drafts without changing the applied result", async () => {
    const user = userEvent.setup();
    const applied: ProcessingSpec = {
      ...DEFAULT_PROCESSING,
      pixel_stride: 2,
      knn_filter: { k: 16, std_ratio: 2 },
    };
    useWorkbenchStore.setState({
      appliedProcessing: applied,
      draftProcessing: applied,
    });
    render(panel());

    fireEvent.change(screen.getByLabelText("像素步长"), {
      target: { value: "4" },
    });
    expect(screen.getByText("有未应用更改")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "还原已应用" }));
    expect(useWorkbenchStore.getState().draftProcessing).toEqual(applied);
    expect(screen.getByLabelText("像素步长")).toHaveValue(2);

    await user.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(useWorkbenchStore.getState().draftProcessing).toEqual(
      DEFAULT_PROCESSING,
    );
    expect(useWorkbenchStore.getState().appliedProcessing).toBe(applied);
    expect(screen.getByText("有未应用更改")).toBeInTheDocument();
    expect(apiMocks.createDerivation).not.toHaveBeenCalled();
  });

  it("lets an invalid optional value be recovered even when JSON serializes it as null", async () => {
    const user = userEvent.setup();
    useWorkbenchStore.setState({
      appliedProcessing: { ...DEFAULT_PROCESSING },
      draftProcessing: { ...DEFAULT_PROCESSING, voxel_size: Number.NaN },
    });
    render(panel());

    expect(screen.getByText("有未应用更改")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用处理" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "还原已应用" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(useWorkbenchStore.getState().draftProcessing.voxel_size).toBeNull();
  });

  it.each(["blocked", "busy"] as const)(
    "locks all editing while %s",
    async (state) => {
      const user = userEvent.setup();
      useWorkbenchStore.setState({ derivationBusy: state === "busy" });
      render(panel(state !== "blocked"));

      await user.click(screen.getByText("高级处理"));
      screen
        .getAllByRole("spinbutton")
        .forEach((input) => expect(input).toBeDisabled());
      screen
        .getAllByRole("checkbox")
        .forEach((input) => expect(input).toBeDisabled());
      screen
        .getAllByRole("button")
        .forEach((button) => expect(button).toBeDisabled());
    },
  );
});
