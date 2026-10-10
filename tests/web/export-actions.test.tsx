import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExportActions } from "../../web/src/features/pointcloud/ExportActions";
import type { PointCloudViewerHandle } from "../../web/src/features/pointcloud/PointCloudViewer";
import { derivationResponse } from "./pointcloud-fixtures";

function viewerRef(
  capturePng = vi.fn<() => string | null>(
    () => "data:image/png;base64,fixture",
  ),
) {
  return {
    current: {
      capturePng,
      resetView: vi.fn(),
      setCameraPose: vi.fn(),
      selectPixel: vi.fn(() => null),
    } satisfies PointCloudViewerHandle,
  };
}

describe("ExportActions", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("waits for a ready viewer before enabling PNG while keeping data exports available", () => {
    const ref = viewerRef();
    const { rerender } = render(
      <ExportActions
        urls={derivationResponse().urls}
        viewerRef={ref}
        displayName="Scene"
        ready={false}
      />,
    );
    expect(screen.getByRole("button", { name: "下载 PNG" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下载 PNG" })).toHaveAttribute(
      "title",
      "等待点云加载完成",
    );
    expect(screen.getByRole("link", { name: "下载 PLY" })).toHaveAttribute(
      "href",
      derivationResponse().urls.ply,
    );
    expect(screen.getByRole("link", { name: "下载参数 JSON" })).toHaveAttribute(
      "href",
      derivationResponse().urls.json,
    );
    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));
    expect(ref.current.capturePng).not.toHaveBeenCalled();

    rerender(
      <ExportActions
        urls={derivationResponse().urls}
        viewerRef={ref}
        displayName="Scene"
        ready
      />,
    );
    expect(screen.getByRole("button", { name: "下载 PNG" })).toBeEnabled();
  });

  it("downloads the current screenshot with readiness enabled by default", () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const ref = viewerRef();
    render(
      <ExportActions
        urls={derivationResponse().urls}
        viewerRef={ref}
        displayName="Desk Scene"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));

    expect(ref.current.capturePng).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
      "Desk-Scene-pointcloud.png",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports screenshot failures and clears the message after retrying successfully", () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const capture = vi
      .fn<() => string | null>()
      .mockImplementationOnce(() => {
        throw new Error("Capture failed");
      })
      .mockReturnValue("data:image/png;base64,fixture");
    render(
      <ExportActions
        urls={derivationResponse().urls}
        viewerRef={viewerRef(capture)}
        displayName="Scene"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));
    expect(screen.getByRole("alert")).toHaveTextContent("截图失败，请重试。");
    expect(click).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));
    expect(click).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a missing screenshot instead of silently doing nothing", () => {
    render(
      <ExportActions
        urls={derivationResponse().urls}
        viewerRef={viewerRef(vi.fn(() => null))}
        displayName="Scene"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "下载 PNG" }));
    expect(screen.getByRole("alert")).toHaveTextContent("截图失败");
  });
});
