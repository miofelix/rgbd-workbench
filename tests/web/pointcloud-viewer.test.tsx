import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pointcloudPayload } from "./pointcloud-fixtures";

const sceneMocks = vi.hoisted(() => ({
  setPoints: vi.fn(),
  setSelectedPoints: vi.fn(),
  resetView: vi.fn(),
  setViewSpec: vi.fn(),
  setCameraPose: vi.fn(),
  pick: vi.fn(),
  selectPixel: vi.fn(),
  capturePng: vi.fn(() => "data:image/png;base64,fixture"),
  dispose: vi.fn(),
}));

vi.mock("../../web/src/viewer/pointcloud-scene", () => ({
  createPointCloudScene: vi.fn(() => sceneMocks),
}));

import {
  PointCloudViewer,
  type PointCloudViewerHandle,
} from "../../web/src/features/pointcloud/PointCloudViewer";

function response() {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => pointcloudPayload(),
  };
}

describe("PointCloudViewer", () => {
  beforeEach(() => {
    sceneMocks.pick.mockReset();
    sceneMocks.selectPixel.mockReset();
    sceneMocks.capturePng
      .mockReset()
      .mockReturnValue("data:image/png;base64,fixture");
  });
  afterEach(() => {
    cleanup();
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
    expect(sceneMocks.setViewSpec).toHaveBeenCalled();
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

    expect(await screen.findByRole("alert")).toHaveTextContent(/无法加载点云/);
    expect(screen.getByRole("button", { name: "重新加载点云" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "适配视图" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("加载失败");
    fireEvent.click(screen.getByTestId("pointcloud-canvas"));
    expect(sceneMocks.pick).not.toHaveBeenCalled();
  });

  it("blocks controls, selection, and screenshots until the point cloud is ready", async () => {
    let resolveResponse: (value: ReturnType<typeof response>) => void = () =>
      undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<ReturnType<typeof response>>((resolve) => {
            resolveResponse = resolve;
          }),
      ),
    );
    const onReadyChange = vi.fn();
    const ref = createRef<PointCloudViewerHandle>();
    render(
      <PointCloudViewer
        ref={ref}
        pointcloudUrl="/pending.bin"
        onPointSelected={vi.fn()}
        onReadyChange={onReadyChange}
      />,
    );

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "透视投影" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "正交投影" })).toBeDisabled();
    expect(screen.getByLabelText("点云着色")).toBeDisabled();
    expect(screen.getByLabelText("点大小")).toBeDisabled();
    expect(screen.getByRole("button", { name: "适配视图" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("正在加载点云");
    expect(ref.current?.capturePng()).toBeNull();
    expect(ref.current?.selectPixel(0)).toBeNull();
    ref.current?.resetView();
    fireEvent.click(screen.getByTestId("pointcloud-canvas"));
    expect(sceneMocks.resetView).not.toHaveBeenCalled();
    expect(sceneMocks.pick).not.toHaveBeenCalled();
    expect(sceneMocks.capturePng).not.toHaveBeenCalled();
    expect(onReadyChange).toHaveBeenLastCalledWith(false);

    await act(async () => resolveResponse(response()));
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("button", { name: "适配视图" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "透视投影" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "正交投影" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByText(/拖动旋转.*滚轮缩放.*点击选点/),
    ).toBeInTheDocument();
    expect(ref.current?.capturePng()).toBe("data:image/png;base64,fixture");
  });

  it("retries a failed request and announces readiness after loading", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchMock);
    const onReadyChange = vi.fn();
    const { unmount } = render(
      <PointCloudViewer
        pointcloudUrl="/retry.bin"
        onPointSelected={vi.fn()}
        onReadyChange={onReadyChange}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
    expect(onReadyChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole("button", { name: "重新加载点云" }));

    await waitFor(() => expect(sceneMocks.setPoints).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sceneMocks.dispose).toHaveBeenCalledTimes(1);
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();
    expect(onReadyChange).toHaveBeenLastCalledWith(false);
  });

  it("updates readiness callbacks without fetching again or replacing its handle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
    const ref = createRef<PointCloudViewerHandle>();
    const { rerender } = render(
      <PointCloudViewer
        ref={ref}
        pointcloudUrl="/stable.bin"
        onPointSelected={vi.fn()}
        onReadyChange={vi.fn()}
      />,
    );
    await waitFor(() => expect(sceneMocks.setPoints).toHaveBeenCalledTimes(1));
    const handle = ref.current;
    const updatedCallback = vi.fn();
    rerender(
      <PointCloudViewer
        ref={ref}
        pointcloudUrl="/stable.bin"
        onPointSelected={vi.fn()}
        onReadyChange={updatedCallback}
      />,
    );

    expect(updatedCallback).toHaveBeenLastCalledWith(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ref.current).toBe(handle);
  });

  it("suppresses the click after dragging and still selects with a tap", async () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response()),
    );
    const point = { pixelIndex: 1, position: [0, 0, 1], unit: "m" };
    sceneMocks.pick.mockReturnValue(point);
    const onPointSelected = vi.fn();
    render(
      <PointCloudViewer
        pointcloudUrl="/drag.bin"
        onPointSelected={onPointSelected}
      />,
    );
    await waitFor(() => expect(sceneMocks.setPoints).toHaveBeenCalledTimes(1));
    const canvas = screen.getByTestId("pointcloud-canvas");

    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    expect(onPointSelected).not.toHaveBeenCalled();

    fireEvent.pointerDown(canvas, {
      pointerId: 2,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 12, clientY: 11 });
    fireEvent.click(canvas, { clientX: 12, clientY: 11 });
    expect(sceneMocks.pick).toHaveBeenCalledTimes(1);
    expect(onPointSelected).toHaveBeenCalledWith(point);
  });

  it("ignores an obsolete response when the source changes", async () => {
    let resolveFirst: (value: ReturnType<typeof response>) => void = () =>
      undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof response>>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue(response());
    vi.stubGlobal("fetch", fetchMock);
    const onReadyChange = vi.fn();
    const { rerender } = render(
      <PointCloudViewer
        pointcloudUrl="/old.bin"
        onPointSelected={vi.fn()}
        onReadyChange={onReadyChange}
      />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    rerender(
      <PointCloudViewer
        pointcloudUrl="/new.bin"
        onPointSelected={vi.fn()}
        onReadyChange={onReadyChange}
      />,
    );

    await waitFor(() => expect(sceneMocks.setPoints).toHaveBeenCalledTimes(1));
    expect(firstSignal.aborted).toBe(true);
    await act(async () => resolveFirst(response()));
    expect(sceneMocks.setPoints).toHaveBeenCalledTimes(1);
    expect(onReadyChange.mock.calls.filter(([ready]) => ready)).toHaveLength(1);
  });
});
