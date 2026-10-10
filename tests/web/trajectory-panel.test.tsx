import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PointCloudViewerHandle } from "../../web/src/features/pointcloud/PointCloudViewer";
import { TrajectoryPanel } from "../../web/src/features/trajectory/TrajectoryPanel";
import * as sampler from "../../web/src/trajectory/sampler";
import { derivationManifest } from "./pointcloud-fixtures";

const actualSampleCameraPath = sampler.sampleCameraPath;

function viewerHandle(): PointCloudViewerHandle {
  return {
    capturePng: vi.fn(() => null),
    resetView: vi.fn(),
    setCameraPose: vi.fn(),
    selectPixel: vi.fn(() => null),
  };
}

function setup(viewerReady = true) {
  const derivation = derivationManifest();
  const viewerRef = createRef<PointCloudViewerHandle>();
  const handle = viewerHandle();
  viewerRef.current = handle;
  const props = { derivation, viewerRef, viewerReady };
  return {
    ...render(<TrajectoryPanel {...props} />),
    props,
    handle,
  };
}

describe("trajectory preview controls", () => {
  beforeEach(() => {
    vi.spyOn(sampler, "sampleCameraPath").mockImplementation((path) => {
      if (sampler.frameCount(path.duration, path.fps) > 6_000) {
        throw new Error("An over-budget preview must not reach the sampler");
      }
      return actualSampleCameraPath(path);
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects oversized previews before sampling and recovers within the frame budget", () => {
    const { handle } = setup();
    fireEvent.change(screen.getByLabelText("轨迹帧率"), {
      target: { value: "240" },
    });
    fireEvent.change(screen.getByLabelText("轨迹时长"), {
      target: { value: "25" },
    });
    expect(screen.getByText("6,000 帧")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放轨迹" })).toBeEnabled();

    vi.mocked(sampler.sampleCameraPath).mockClear();
    vi.mocked(handle.setCameraPose).mockClear();
    fireEvent.change(screen.getByLabelText("轨迹时长"), {
      target: { value: "3600" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("864,000 帧");
    expect(screen.getByRole("alert")).toHaveTextContent("请缩短时长或降低帧率");
    expect(sampler.sampleCameraPath).not.toHaveBeenCalled();
    expect(handle.setCameraPose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "播放轨迹" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重置轨迹" })).toBeDisabled();
    expect(screen.getByLabelText("轨迹进度")).toBeDisabled();
    expect(screen.getByText("未采样")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("轨迹帧率"), {
      target: { value: "1" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("轨迹时长")).toHaveValue(3600);
    expect(screen.getByText("3,600 帧")).toBeInTheDocument();
    expect(sampler.sampleCameraPath).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("轨迹进度")).toBeEnabled();
  });

  it("allows duration and fps to be cleared and filled without forced replacement", async () => {
    const user = userEvent.setup();
    setup();
    const duration = screen.getByLabelText("轨迹时长");
    const fps = screen.getByLabelText("轨迹帧率");

    await user.clear(duration);
    expect(duration).toHaveValue(null);
    expect(screen.getByRole("button", { name: "播放轨迹" })).toBeDisabled();
    await user.type(duration, "12.5");
    expect(duration).toHaveValue(12.5);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.clear(fps);
    expect(fps).toHaveValue(null);
    expect(screen.getByLabelText("轨迹进度")).toBeDisabled();
    await user.type(fps, "60");
    expect(fps).toHaveValue(60);
    expect(screen.getByText("750 帧")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放轨迹" })).toBeEnabled();
  });

  it.each([
    ["轨迹时长", "0.05", "0.1–3600"],
    ["轨迹时长", "3601", "0.1–3600"],
    ["轨迹帧率", "2.5", "1–240"],
    ["轨迹帧率", "241", "1–240"],
  ])(
    "keeps invalid %s input %s visible while preventing sampling",
    (label, value, message) => {
      setup();
      vi.mocked(sampler.sampleCameraPath).mockClear();
      fireEvent.change(screen.getByLabelText(label), { target: { value } });

      expect(screen.getByLabelText(label)).toHaveValue(Number(value));
      expect(screen.getByLabelText(label)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(sampler.sampleCameraPath).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "播放轨迹" })).toBeDisabled();
    },
  );

  it("applies the current pose when the viewer first becomes ready and after a reload", async () => {
    const user = userEvent.setup();
    const { handle, props, rerender } = setup(false);
    expect(handle.setCameraPose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "播放轨迹" })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("轨迹预设"), "spiral");
    expect(handle.setCameraPose).not.toHaveBeenCalled();
    const poses = vi
      .mocked(sampler.sampleCameraPath)
      .mock.results.at(-1)!.value;
    rerender(<TrajectoryPanel {...props} viewerReady />);
    expect(handle.setCameraPose).toHaveBeenLastCalledWith(poses[0]);

    fireEvent.change(screen.getByLabelText("轨迹进度"), {
      target: { value: "37" },
    });
    expect(handle.setCameraPose).toHaveBeenLastCalledWith(poses[37]);
    rerender(<TrajectoryPanel {...props} viewerReady={false} />);
    vi.mocked(handle.setCameraPose).mockClear();
    rerender(<TrajectoryPanel {...props} viewerReady />);
    expect(handle.setCameraPose).toHaveBeenCalledExactlyOnceWith(poses[37]);
  });

  it("stops playback and cancels its animation when parameters become invalid", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "播放轨迹" }));
    expect(
      screen.getByRole("button", { name: "暂停轨迹" }),
    ).toBeInTheDocument();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    fireEvent.change(screen.getByLabelText("轨迹帧率"), {
      target: { value: "" },
    });
    expect(screen.getByRole("button", { name: "播放轨迹" })).toBeDisabled();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
  });

  it("starts a changed preset at its first pose without applying the previous frame index", async () => {
    const user = userEvent.setup();
    const { handle } = setup();
    fireEvent.change(screen.getByLabelText("轨迹进度"), {
      target: { value: "37" },
    });
    vi.mocked(handle.setCameraPose).mockClear();

    await user.selectOptions(screen.getByLabelText("轨迹预设"), "spiral");
    const poses = vi
      .mocked(sampler.sampleCameraPath)
      .mock.results.at(-1)!.value;
    expect(handle.setCameraPose).toHaveBeenCalled();
    vi.mocked(handle.setCameraPose).mock.calls.forEach(([pose]) => {
      expect(pose).toEqual(poses[0]);
    });
    expect(screen.getByLabelText("轨迹进度")).toHaveValue("0");
  });
  it("restarts one-shot playback from the first frame after reaching the end", async () => {
    const user = userEvent.setup();
    const { handle } = setup();
    await user.selectOptions(screen.getByLabelText("轨迹循环模式"), "once");
    fireEvent.change(screen.getByLabelText("轨迹进度"), {
      target: { value: "149" },
    });
    expect(screen.getByLabelText("轨迹进度")).toHaveValue("149");
    await user.click(screen.getByRole("button", { name: "播放轨迹" }));
    expect(screen.getByLabelText("轨迹进度")).toHaveValue("0");
    expect(screen.getByRole("button", { name: "暂停轨迹" })).toBeEnabled();
    expect(vi.mocked(handle.setCameraPose).mock.lastCall?.[0].time).toBe(0);
  });
});
