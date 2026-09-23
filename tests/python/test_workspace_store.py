from __future__ import annotations

import hashlib
import json
import os
from io import BytesIO
from pathlib import Path

import pytest

from rgbd_workbench.domain.contracts import (
    AlignmentSpec,
    CameraSpec,
    DepthSpec,
    SceneManifestV1,
    SourceRef,
)
from rgbd_workbench.workspace.paths import WorkspacePaths
from rgbd_workbench.workspace.store import StagedFile, WorkspaceStore


def make_manifest(rgb: SourceRef, depth: SourceRef) -> SceneManifestV1:
    return SceneManifestV1(
        schema_version=1,
        scene_id="scene-1",
        display_name="Scene 1",
        rgb=rgb,
        depth=depth,
        depth_spec=DepthSpec(representation="z_depth", unit="mm"),
        camera=CameraSpec(
            model="pinhole",
            width=2,
            height=2,
            fx=10.0,
            fy=10.0,
            cx=1.0,
            cy=1.0,
            distortion_model="none",
        ),
        alignment=AlignmentSpec(state="registered_to_rgb"),
        frame_id="camera",
        normalizer_version="1",
        adapter_versions={"rgb": "1", "depth": "1"},
    )


def source_from_staged(role: str, staged: StagedFile) -> SourceRef:
    return SourceRef(
        role=role,
        source_id=staged.source_id,
        filename=staged.filename,
        sha256=staged.sha256,
        size_bytes=staged.size_bytes,
        width=2,
        height=2,
    )


def test_workspace_paths_initialize_expected_directories(tmp_path: Path):
    paths = WorkspacePaths(tmp_path / "workspace")
    paths.initialize()

    assert paths.root.is_dir()
    assert paths.staging.is_dir()
    assert paths.scenes.is_dir()
    assert paths.jobs.is_dir()
    assert paths.cache.is_dir()
    assert paths.exports.is_dir()


def test_workspace_rejects_filesystem_root_as_workspace():
    with pytest.raises(ValueError, match="filesystem root"):
        WorkspacePaths(Path("/"))


def test_stage_bytes_enforces_limit_and_cleans_partial_file(tmp_path: Path):
    store = WorkspaceStore(tmp_path / "workspace")
    store.initialize()

    with pytest.raises(ValueError, match="byte limit"):
        store.stage_bytes("depth.bin", BytesIO(b"12345"), max_bytes=4)

    assert list(store.paths.staging.iterdir()) == []


def test_stage_bytes_cleans_temporary_file_when_stream_fails(tmp_path: Path):
    class BrokenStream:
        def __init__(self):
            self.calls = 0

        def read(self, size: int = -1) -> bytes:
            self.calls += 1
            if self.calls == 1:
                return b"partial"
            raise OSError("source interrupted")

    store = WorkspaceStore(tmp_path / "workspace")
    store.initialize()

    with pytest.raises(OSError, match="source interrupted"):
        store.stage_bytes("depth.bin", BrokenStream(), max_bytes=100)  # type: ignore[arg-type]

    assert list(store.paths.staging.iterdir()) == []


def test_managed_commit_sanitizes_names_and_preserves_source_bytes(tmp_path: Path):
    store = WorkspaceStore(tmp_path / "workspace")
    store.initialize()
    original_rgb = b"rgb-source"
    original_depth = b"depth-source"
    rgb = store.stage_bytes("../../color image.png", BytesIO(original_rgb), max_bytes=100)
    depth = store.stage_bytes("depth.npy", BytesIO(original_depth), max_bytes=100)
    manifest = make_manifest(source_from_staged("rgb", rgb), source_from_staged("depth", depth))

    committed = store.commit_scene(manifest, {"rgb": rgb, "depth": depth})
    rgb_path = tmp_path / "workspace/scenes/scene-1/sources" / committed.rgb.filename
    depth_path = tmp_path / "workspace/scenes/scene-1/sources" / committed.depth.filename

    assert rgb.filename == "color image.png"
    assert Path(rgb.safe_name).name == rgb.safe_name
    assert rgb_path.read_bytes() == original_rgb
    assert depth_path.read_bytes() == original_depth
    assert committed == store.get_scene("scene-1")
    assert [item.scene_id for item in store.list_scenes()] == ["scene-1"]
    assert hashlib.sha256(rgb_path.read_bytes()).hexdigest() == committed.rgb.sha256
    assert not rgb.path.exists()
    assert not depth.path.exists()


def test_linked_sources_are_canonical_private_and_revalidated(tmp_path: Path):
    input_dir = tmp_path / "input"
    input_dir.mkdir()
    rgb_path = input_dir / "rgb.png"
    depth_path = input_dir / "depth.png"
    rgb_path.write_bytes(b"rgb")
    depth_path.write_bytes(b"depth")

    store = WorkspaceStore(tmp_path / "workspace")
    store.initialize()
    rgb = store.register_linked(rgb_path, "rgb")
    depth = store.register_linked(depth_path, "depth")
    rgb = rgb.model_copy(update={"width": 2, "height": 2})
    depth = depth.model_copy(update={"width": 2, "height": 2})
    manifest = make_manifest(rgb, depth)
    store.commit_scene(manifest, {})
    committed_scene = (tmp_path / "workspace/scenes/scene-1/scene.json").read_bytes()
    locator_data = json.loads(
        (tmp_path / "workspace/scenes/scene-1/private-locators.json").read_text()
    )
    assert locator_data["rgb"]["mtime_ns"] == rgb_path.stat().st_mtime_ns
    assert locator_data["rgb"]["device"] == rgb_path.stat().st_dev
    assert locator_data["rgb"]["inode"] == rgb_path.stat().st_ino

    stat_result = depth_path.stat()
    os.utime(depth_path, ns=(stat_result.st_atime_ns, stat_result.st_mtime_ns + 1_000_000))
    touched = store.revalidate_scene("scene-1")
    assert [item.code for item in touched] == ["LINKED_SOURCE_STALE"]

    rgb_path.write_bytes(b"changed")
    changed = store.revalidate_scene("scene-1")
    assert {item.code for item in changed} == {"LINKED_SOURCE_STALE"}
    assert str(input_dir) not in repr(store.get_scene("scene-1").model_dump())
    assert (tmp_path / "workspace/scenes/scene-1/scene.json").read_bytes() == committed_scene

    rgb_path.unlink()
    missing = store.revalidate_scene("scene-1")
    assert "LINKED_SOURCE_MISSING" in {item.code for item in missing}
    assert depth_path.read_bytes() == b"depth"


def test_write_destination_rejects_symlink_escape(tmp_path: Path):
    workspace = tmp_path / "workspace"
    outside = tmp_path / "outside"
    workspace.mkdir()
    outside.mkdir()
    (workspace / "escape").symlink_to(outside, target_is_directory=True)

    paths = WorkspacePaths(workspace)
    with pytest.raises(ValueError, match="outside workspace"):
        paths.resolve_write_path("escape/output.bin")
