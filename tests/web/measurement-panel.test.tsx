import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SelectedPoint } from "../../web/src/api/types";
import { MeasurementPanel } from "../../web/src/features/pointcloud/MeasurementPanel";

const points: SelectedPoint[] = [
  { pixelIndex: 0, position: [0, 0, 0], unit: "m" },
  { pixelIndex: 1, position: [3, 4, 0], unit: "m" },
];

describe("MeasurementPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("copies the metric distance and shows confirmation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<MeasurementPanel points={points} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "复制米制距离" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "已复制米制距离。",
    );
    expect(writeText).toHaveBeenCalledWith("5.000000");
  });

  it("reports clipboard rejection and allows another attempt", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("Denied"))
      .mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<MeasurementPanel points={points} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "复制米制距离" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("复制失败");
    expect(screen.getByRole("button", { name: "复制米制距离" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "复制米制距离" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "已复制米制距离。",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports when the browser has no clipboard API", async () => {
    vi.stubGlobal("navigator", {});
    render(<MeasurementPanel points={points} onClear={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "复制米制距离" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("复制失败");
  });

  it("keeps unitless measurements without a metric copy action", () => {
    const relative = points.map((point) => ({
      ...point,
      unit: "unitless" as const,
    }));
    render(<MeasurementPanel points={relative} onClear={vi.fn()} />);
    expect(screen.getByTestId("measurement-distance")).toHaveTextContent(
      "5.0000 unitless",
    );
    expect(
      screen.queryByRole("button", { name: "复制米制距离" }),
    ).not.toBeInTheDocument();
  });

  it("ignores a pending copy after the selected points change", async () => {
    let resolveCopy: () => void = () => undefined;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { rerender } = render(
      <MeasurementPanel points={points} onClear={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制米制距离" }));
    expect(screen.getByRole("button", { name: "复制米制距离" })).toBeDisabled();

    rerender(<MeasurementPanel points={[points[0]]} onClear={vi.fn()} />);
    await act(async () => resolveCopy());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears feedback when the measurement is cleared", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const onClear = vi.fn();
    const { rerender } = render(
      <MeasurementPanel points={points} onClear={onClear} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "复制米制距离" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "清除选点" }));
    expect(onClear).toHaveBeenCalledOnce();

    rerender(<MeasurementPanel points={[]} onClear={onClear} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByText("在点云中选择两个点以测量距离。"),
    ).toBeInTheDocument();
  });
});
