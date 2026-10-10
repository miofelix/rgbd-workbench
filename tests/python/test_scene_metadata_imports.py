from __future__ import annotations

import io
import json
import os
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from rgbd_workbench.adapters.registry import AdapterRegistry
from rgbd_workbench.api.app import create_app, seed_import_from_paths


def authorized_client(tmp_path: Path, **kwargs: Any) -> TestClient:
    application = create_app(tmp_path / "workspace", **kwargs)
    client = TestClient(application, raise_server_exceptions=False)
    client.cookies.set("rgbd_session", application.state.session_cookie)
    return client


def camera() -> dict[str, Any]:
    return {
        "model": "pinhole",
        "width": 2,
        "height": 2,
        "fx": 10.0,
        "fy": 10.0,
        "cx": 1.0,
        "cy": 1.0,
        "distortion_model": "none",
    }


def saved_scene(
    client: TestClient,
    tmp_path: Path,
    metadata: dict[str, Any] | None = None,
    *,
    linked: bool = False,
    raw: bool = False,
) -> str:
    source_dir = tmp_path / "private-inputs"
    source_dir.mkdir(exist_ok=True)
    rgb_path = source_dir / "color.png"
    Image.new("RGB", (2, 2), (20, 40, 60)).save(rgb_path)
    depth_path = source_dir / ("depth.raw" if raw else "depth.npy")
    depth = np.array([[100, 200], [0, 300]], dtype=np.uint16)
    if raw:
        depth_path.write_bytes(depth.astype("<u2").tobytes())
        manifest_path = source_dir / "manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "depth": {
                        "representation": "z_depth",
                        "unit": "mm",
                        "raw_descriptor": {
                            "shape": [2, 2],
                            "dtype": "uint16",
                            "endianness": "little",
                        },
                    },
                }
            )
        )
    else:
        with depth_path.open("wb") as output:
            np.save(output, depth)
        manifest_path = None
    import_id = seed_import_from_paths(
        client.app, rgb_path, depth_path, manifest_path, linked=linked
    )
    if metadata is not None:
        confirmed = client.put(f"/api/v1/imports/{import_id}/metadata", json=metadata)
        assert confirmed.status_code == 200
    committed = client.post(f"/api/v1/imports/{import_id}/commit")
    assert committed.status_code == 201
    return committed.json()["scene"]["scene_id"]


def metric_metadata() -> dict[str, Any]:
    return {
        "display_name": "Original Scene",
        "representation": "z_depth",
        "unit": "mm",
        "invalid_values": [0.0],
        "valid_min": 0.05,
        "valid_max": 1.0,
        "camera": camera(),
        "alignment": {"state": "registered_to_rgb", "method": "explicit"},
    }


def assert_no_private_paths(payload: Any, tmp_path: Path) -> None:
    serialized = json.dumps(payload)
    assert str(tmp_path) not in serialized
    assert "private-locators" not in serialized
    assert '"path"' not in serialized


def test_reopen_requires_session_and_local_origin(tmp_path: Path):
    client = authorized_client(tmp_path)
    scene_id = saved_scene(client, tmp_path)
    client.cookies.clear()
    assert client.post(f"/api/v1/scenes/{scene_id}/imports").status_code == 401
    client.cookies.set("rgbd_session", client.app.state.session_cookie)
    response = client.post(
        f"/api/v1/scenes/{scene_id}/imports", headers={"origin": "https://example.com"}
    )
    assert response.status_code == 403
    assert client.app.state.imports == {}


@pytest.mark.parametrize("scene_id", ["absent", "invalid.id", "invalid\\scene"])
def test_reopen_unknown_or_invalid_scene_is_redacted_404(tmp_path: Path, scene_id: str):
    client = authorized_client(tmp_path)
    response = client.post(f"/api/v1/scenes/{scene_id}/imports")
    assert response.status_code == 404
    assert response.json() == {"detail": "scene not found"}
    assert_no_private_paths(response.json(), tmp_path)


@pytest.mark.parametrize(
    "semantics",
    [
        {"representation": "z_depth", "unit": "mm"},
        {"representation": "z_depth", "scale_to_meter": 0.001},
        {"representation": "relative_z", "unit": "unitless"},
    ],
)
def test_managed_reopen_preserves_semantics_and_commits_independent_scene(
    tmp_path: Path, semantics: dict[str, Any]
):
    client = authorized_client(tmp_path)
    metadata = {**metric_metadata(), **semantics}
    if "scale_to_meter" in semantics:
        metadata.pop("unit")
    scene_id = saved_scene(client, tmp_path, metadata)
    store = client.app.state.workspace_store
    original = store.get_scene(scene_id)
    original_document = (store.paths.scenes / scene_id / "scene.json").read_bytes()
    original_sources = {
        role: store.resolve_scene_source(scene_id, role).read_bytes() for role in ("rgb", "depth")
    }

    response = client.post(f"/api/v1/scenes/{scene_id}/imports")
    assert response.status_code == 201
    payload = response.json()
    assert payload["source_scene_id"] == scene_id
    import_id = payload["import_id"]
    assert payload["scene"]["scene_id"] != scene_id
    assert payload["scene"]["depth_spec"] == original.depth_spec.model_dump(mode="json")
    assert payload["scene"]["camera"] == original.camera.model_dump(mode="json")
    assert payload["scene"]["alignment"] == original.alignment.model_dump(mode="json")
    assert payload["scene"]["display_name"] == metadata["display_name"]
    assert payload["candidates"]["rgb"]["source"]["source_id"] != original.rgb.source_id
    assert_no_private_paths(payload, tmp_path)
    assert client.get(f"/api/v1/imports/{import_id}").json() == payload

    metadata["display_name"] = "Completed Scene"
    confirmed = client.put(f"/api/v1/imports/{import_id}/metadata", json=metadata)
    assert confirmed.status_code == 200
    committed = client.post(f"/api/v1/imports/{import_id}/commit")
    assert committed.status_code == 201
    new_scene_id = committed.json()["scene"]["scene_id"]
    assert new_scene_id != scene_id
    assert store.get_scene(new_scene_id).display_name == "Completed Scene"
    assert (store.paths.scenes / scene_id / "scene.json").read_bytes() == original_document
    for role, expected in original_sources.items():
        assert store.resolve_scene_source(scene_id, role).read_bytes() == expected
        assert store.resolve_scene_source(new_scene_id, role).read_bytes() == expected
        assert store.resolve_scene_source(scene_id, role) != store.resolve_scene_source(
            new_scene_id, role
        )
    assert list(store.paths.staging.iterdir()) == []
    assert client.get(f"/api/v1/imports/{import_id}").status_code == 404


def test_saved_2d_scene_can_complete_metadata_without_guessing_or_changing_original(tmp_path: Path):
    client = authorized_client(tmp_path)
    scene_id = saved_scene(client, tmp_path)
    reopened = client.post(f"/api/v1/scenes/{scene_id}/imports")
    assert reopened.status_code == 201
    payload = reopened.json()
    assert payload["scene"]["depth_spec"] is None
    assert payload["scene"]["camera"] is None
    assert payload["scene"]["alignment"] is None
    assert payload["capabilities"]["metric_pointcloud"] is False
    import_id = payload["import_id"]
    assert (
        client.put(
            f"/api/v1/imports/{import_id}/metadata",
            json={"representation": "z_depth", "unit": "unitless"},
        ).status_code
        == 422
    )
    confirmed = client.put(f"/api/v1/imports/{import_id}/metadata", json=metric_metadata())
    assert confirmed.status_code == 200
    assert confirmed.json()["capabilities"]["metric_pointcloud"] is True
    committed = client.post(f"/api/v1/imports/{import_id}/commit")
    assert committed.status_code == 201
    new_scene_id = committed.json()["scene"]["scene_id"]
    derived = client.post(f"/api/v1/scenes/{new_scene_id}/derivations", json={"schema_version": 1})
    assert derived.status_code == 201
    assert derived.json()["derivation"]["point_count"] == 3
    assert client.get(f"/api/v1/scenes/{scene_id}").json()["scene"]["depth_spec"] is None


def test_raw_descriptor_and_coordinate_metadata_survive_reopen_and_confirmation(tmp_path: Path):
    client = authorized_client(tmp_path)
    scene_id = saved_scene(client, tmp_path, metric_metadata(), raw=True)
    store = client.app.state.workspace_store
    original = store.get_scene(scene_id)
    document = store.paths.scenes / scene_id / "scene.json"
    document.write_text(
        original.model_copy(
            update={"frame_id": "optical_camera", "adapter_versions": {"rgb": "1", "depth": "2"}}
        ).model_dump_json()
    )
    original = store.get_scene(scene_id)
    reopened = client.post(f"/api/v1/scenes/{scene_id}/imports")
    assert reopened.status_code == 201
    assert "RAW_DESCRIPTOR_REQUIRED" not in {
        item["code"] for item in reopened.json()["diagnostics"]
    }
    import_id = reopened.json()["import_id"]
    assert (
        client.put(f"/api/v1/imports/{import_id}/metadata", json=metric_metadata()).status_code
        == 200
    )
    committed = client.post(f"/api/v1/imports/{import_id}/commit")
    assert committed.status_code == 201
    new_scene = store.get_scene(committed.json()["scene"]["scene_id"])
    assert new_scene.raw_descriptor == original.raw_descriptor
    assert new_scene.frame_id == original.frame_id
    assert new_scene.coordinate_convention == original.coordinate_convention
    assert new_scene.normalizer_version == original.normalizer_version
    assert new_scene.adapter_versions == original.adapter_versions
    derived = client.post(
        f"/api/v1/scenes/{new_scene.scene_id}/derivations", json={"schema_version": 1}
    )
    assert derived.status_code == 201


def test_linked_reopen_after_restart_preserves_private_validated_locators(tmp_path: Path):
    first_client = authorized_client(tmp_path)
    scene_id = saved_scene(first_client, tmp_path, metric_metadata(), linked=True)
    client = authorized_client(tmp_path)
    store = client.app.state.workspace_store
    original = store.get_scene(scene_id)
    reopened = client.post(f"/api/v1/scenes/{scene_id}/imports")
    assert reopened.status_code == 201
    assert_no_private_paths(reopened.json(), tmp_path)
    assert list(store.paths.staging.iterdir()) == []
    import_id = reopened.json()["import_id"]
    committed = client.post(f"/api/v1/imports/{import_id}/commit")
    assert committed.status_code == 201
    new_scene_id = committed.json()["scene"]["scene_id"]
    assert_no_private_paths(committed.json(), tmp_path)
    assert store.get_scene(new_scene_id).depth_spec == original.depth_spec
    assert store.revalidate_scene(new_scene_id) == []
    for role in ("rgb", "depth"):
        assert store.resolve_scene_source(new_scene_id, role) == store.resolve_scene_source(
            scene_id, role
        )
        assert not store.scene_source_path(new_scene_id, role).exists()


@pytest.mark.parametrize("linked", [False, True])
@pytest.mark.parametrize("missing", [False, True])
def test_reopen_rejects_stale_or_missing_sources_without_partial_draft(
    tmp_path: Path, linked: bool, missing: bool
):
    client = authorized_client(tmp_path)
    scene_id = saved_scene(client, tmp_path, metric_metadata(), linked=linked)
    store = client.app.state.workspace_store
    path = store.resolve_scene_source(scene_id, "depth")
    if missing:
        path.unlink()
    else:
        path.write_bytes(b"changed")
    existing_linked = dict(store._linked_sources)
    response = client.post(f"/api/v1/scenes/{scene_id}/imports")
    assert response.status_code == 409
    expected_code = (
        ("LINKED_SOURCE_MISSING" if missing else "LINKED_SOURCE_STALE")
        if linked
        else ("SCENE_SOURCE_MISSING" if missing else "SCENE_SOURCE_STALE")
    )
    assert response.json()["diagnostics"][0]["code"] == expected_code
    assert_no_private_paths(response.json(), tmp_path)
    assert client.app.state.imports == {}
    assert store._linked_sources == existing_linked
    assert list(store.paths.staging.iterdir()) == []
    assert [scene.scene_id for scene in store.list_scenes()] == [scene_id]


@pytest.mark.parametrize("linked", [False, True])
def test_reopen_probe_failure_cleans_staging_and_registrations(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, linked: bool
):
    client = authorized_client(tmp_path)
    scene_id = saved_scene(client, tmp_path, metric_metadata(), linked=linked)
    store = client.app.state.workspace_store
    existing_linked = dict(store._linked_sources)

    def fail_probe(*args: Any, **kwargs: Any) -> None:
        raise OSError(f"private read failure at {tmp_path}")

    monkeypatch.setattr(AdapterRegistry, "probe", fail_probe)
    response = client.post(f"/api/v1/scenes/{scene_id}/imports")
    assert response.status_code == 422
    assert response.json() == {"detail": "scene import could not be created"}
    assert_no_private_paths(response.json(), tmp_path)
    assert client.app.state.imports == {}
    assert store._linked_sources == existing_linked
    assert list(store.paths.staging.iterdir()) == []
    assert store.revalidate_scene(scene_id) == []


def test_reopen_rejects_source_change_during_snapshot_and_cleans_both_copies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    client = authorized_client(tmp_path)
    scene_id = saved_scene(client, tmp_path, metric_metadata())
    store = client.app.state.workspace_store
    snapshot = store.snapshot_scene_source

    def change_after_snapshot(scene_id: str, role: str, directory: Path) -> Path:
        path = snapshot(scene_id, role, directory)
        if role == "rgb":
            store.scene_source_path(scene_id, role).write_bytes(b"changed after snapshot")
        return path

    monkeypatch.setattr(store, "snapshot_scene_source", change_after_snapshot)
    response = client.post(f"/api/v1/scenes/{scene_id}/imports")
    assert response.status_code == 409
    assert response.json()["diagnostics"][0]["code"] == "SCENE_SOURCE_STALE"
    assert list(store.paths.staging.iterdir()) == []
    assert client.app.state.imports == {}


def test_reopen_respects_copy_limit_without_partial_draft(tmp_path: Path):
    first_client = authorized_client(tmp_path)
    scene_id = saved_scene(first_client, tmp_path, metric_metadata())
    client = authorized_client(tmp_path, max_upload_bytes=1)
    response = client.post(f"/api/v1/scenes/{scene_id}/imports")
    assert response.status_code == 413
    assert_no_private_paths(response.json(), tmp_path)
    assert list(client.app.state.workspace_store.paths.staging.iterdir()) == []
    assert client.app.state.imports == {}


def test_linked_draft_cannot_publish_if_identity_changes_after_reopen(tmp_path: Path):
    client = authorized_client(tmp_path)
    scene_id = saved_scene(client, tmp_path, metric_metadata(), linked=True)
    store = client.app.state.workspace_store
    reopened = client.post(f"/api/v1/scenes/{scene_id}/imports")
    assert reopened.status_code == 201
    path = store.resolve_scene_source(scene_id, "depth")
    previous = path.stat()
    os.utime(path, ns=(previous.st_atime_ns, previous.st_mtime_ns + 1_000_000))
    response = client.post(f"/api/v1/imports/{reopened.json()['import_id']}/commit")
    assert response.status_code == 422
    assert_no_private_paths(response.json(), tmp_path)
    assert [scene.scene_id for scene in store.list_scenes()] == [scene_id]
    assert not list(store.paths.scenes.glob(".*.tmp"))


def test_reopen_keeps_orientation_gate_through_metadata_confirmation(tmp_path: Path):
    client = authorized_client(tmp_path)
    rgb = io.BytesIO()
    image = Image.new("RGB", (2, 2), (20, 40, 60))
    exif = image.getexif()
    exif[274] = 6
    image.save(rgb, format="JPEG", exif=exif.tobytes())
    depth = io.BytesIO()
    np.save(depth, np.ones((2, 2), dtype=np.float32))
    imported = client.post(
        "/api/v1/imports",
        files={
            "rgb": ("rotated.jpg", rgb.getvalue(), "image/jpeg"),
            "depth": ("depth.npy", depth.getvalue(), "application/octet-stream"),
        },
    )
    import_id = imported.json()["import_id"]
    assert (
        client.put(f"/api/v1/imports/{import_id}/metadata", json=metric_metadata()).status_code
        == 200
    )
    committed = client.post(f"/api/v1/imports/{import_id}/commit")
    scene_id = committed.json()["scene"]["scene_id"]
    reopened = client.post(f"/api/v1/scenes/{scene_id}/imports")
    assert reopened.status_code == 201
    assert reopened.json()["capabilities"]["metric_pointcloud"] is False
    confirmed = client.put(
        f"/api/v1/imports/{reopened.json()['import_id']}/metadata", json=metric_metadata()
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["capabilities"]["metric_pointcloud"] is False
    assert "RGB_ORIENTATION_CONFIRMATION_REQUIRED" in {
        item["code"] for item in confirmed.json()["diagnostics"]
    }
