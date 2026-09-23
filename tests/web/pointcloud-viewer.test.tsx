import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pointcloudPayload } from "./pointcloud-fixtures";

const sceneMocks = vi.hoisted(() => ({
  setPoints: vi.fn(),
  resetView: vi.fn(),
  pick: vi.fn(),
  capturePng: vi.fn(() => "data:image/png;base64,fixture"),
  dispose: vi.fn(),
}));

vi.mock("../../web/src/viewer/pointcloud-scene", () => ({
  createPointCloudScene: vi.fn(() => sceneMocks),
}));

import { PointCloudViewer } from "../../web/src/features/pointcloud/PointCloudViewer";

describe("PointCloudViewer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.values(sceneMocks).forEach((mock) => mock.mockClear());
  });

  it("loads points, resets the view, and disposes resources on unmount", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => pointcloudPayload(),
      })),
    );
    const { unmount } = render(
      <PointCloudViewer
        pointcloudUrl="/pointcloud.bin"
        onPointSelected={vi.fn()}
      />,
    );

    await waitFor(() => expect(sceneMocks.setPoints).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "适配视图" }));
    expect(sceneMocks.resetView).toHaveBeenCalledTimes(1);

    unmount();
    expect(sceneMocks.dispose).toHaveBeenCalledTimes(1);
  });

  it("shows a stable error when a binary response is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(4),
      })),
    );
    render(
      <PointCloudViewer
        pointcloudUrl="/broken.bin"
        onPointSelected={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/点云数据无效/);
  });
});
