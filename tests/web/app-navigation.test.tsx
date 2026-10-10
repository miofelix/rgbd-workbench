import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SceneSummary } from "../../web/src/api/types";
import { useWorkbenchStore } from "../../web/src/state/workbench";
import { App } from "../../web/src/app/App";

const api = vi.hoisted(() => ({
  listScenes: vi.fn(),
  reopenSceneImport: vi.fn(),
}));
vi.mock("../../web/src/api/client", () => ({
  listScenes: api.listScenes,
  createDerivation: vi.fn(),
  reopenSceneImport: api.reopenSceneImport,
}));
vi.mock("../../web/src/features/import/ImportWizard", () => ({
  ImportWizard: ({ onCancel }: { onCancel?: () => void }) => (
    <section aria-label="导入向导">
      <input aria-label="测试文件" />
      {onCancel && <button onClick={onCancel}>取消</button>}
    </section>
  ),
}));
vi.mock("../../web/src/features/inspect/SceneInspector", () => ({
  SceneInspector: ({
    scene,
    onEditMetadata,
    metadataBusy,
  }: {
    scene: SceneSummary | null;
    onEditMetadata?: () => void;
    metadataBusy?: boolean;
  }) => (
    <>
      <h2>{scene?.display_name}</h2>
      <button onClick={onEditMetadata} disabled={metadataBusy}>
        编辑场景参数
      </button>
    </>
  ),
}));
function scene(id: string): SceneSummary {
  const source = {
    filename: "image.png",
    sha256_prefix: "a",
    size_bytes: 10,
    width: 2,
    height: 2,
    dtype: "uint8",
  };
  return {
    schema_version: 1,
    scene_id: id,
    display_name: id,
    rgb: { ...source, source_id: "rgb", role: "rgb" },
    depth: { ...source, source_id: "depth", role: "depth" },
    depth_spec: null,
    camera: null,
    alignment: null,
    frame_id: "camera",
    coordinate_convention: "x_right_y_down_z_forward",
    normalizer_version: "1",
    adapter_versions: {},
  };
}
beforeEach(() => {
  useWorkbenchStore.getState().reset();
  window.history.replaceState(null, "", "/");
  api.listScenes.mockReset();
  api.reopenSceneImport.mockReset();
});
afterEach(cleanup);

it("opens import from the add action, returns to analysis, and switches saved scenes", async () => {
  api.listScenes.mockResolvedValue({
    scenes: [scene("first"), scene("second")],
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "first" });
  expect(screen.queryByLabelText("导入向导")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "添加 Scene" }));
  expect(screen.getByLabelText("导入向导")).toBeInTheDocument();
  expect(screen.getByLabelText("测试文件")).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByLabelText("导入向导")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("当前场景"), "second");
  expect(screen.getByRole("heading", { name: "second" })).toBeInTheDocument();
});

it("shows a recoverable scene list error and retries without an unhandled rejection", async () => {
  api.listScenes
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ scenes: [scene("recovered")] });
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("无法读取场景");
  await user.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("heading", { name: "recovered" });
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
});

it("ignores an old metadata draft after selecting another scene", async () => {
  api.listScenes.mockResolvedValue({
    scenes: [scene("first"), scene("second")],
  });
  let finish!: (draft: { import_id: string }) => void;
  api.reopenSceneImport.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole("heading", { name: "first" });
  await user.click(screen.getByRole("button", { name: "编辑场景参数" }));
  const signal = api.reopenSceneImport.mock.calls[0][1] as AbortSignal;
  await user.selectOptions(screen.getByLabelText("当前场景"), "second");
  expect(signal.aborted).toBe(true);
  finish({ import_id: "old-draft" });
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "second" })).toBeInTheDocument(),
  );
  expect(screen.queryByLabelText("导入向导")).not.toBeInTheDocument();
});
