from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from rgbd_workbench.api.app import create_app


def png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), (20, 40, 60)).save(buffer, format="PNG")
    return buffer.getvalue()


def depth_bytes() -> bytes:
    buffer = io.BytesIO()
    np.save(buffer, np.array([[1000, 1200], [0, 1400]], dtype=np.uint16))
    return buffer.getvalue()


def client(tmp_path: Path, **kwargs: object) -> TestClient:
    app = create_app(tmp_path / "workspace", **kwargs)
    return TestClient(app, raise_server_exceptions=False)


def test_health_is_public_and_versioned(tmp_path: Path):
    response = client(tmp_path).get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {
        "schema_version": 1,
        "app_version": "0.1.0",
        "ready": True,
    }


def test_business_routes_require_session_cookie(tmp_path: Path):
    response = client(tmp_path).get("/api/v1/scenes")
    assert response.status_code == 401
    assert response.json()["detail"] == "session required"


def test_business_routes_reject_lookalike_host_and_origin(tmp_path: Path):
    test_client = client(tmp_path)
    test_client.cookies.set("rgbd_session", test_client.app.state.session_cookie)
    host = test_client.get("/api/v1/scenes", headers={"host": "localhost.attacker.example"})
    origin = test_client.get(
        "/api/v1/scenes",
        headers={"origin": "https://attacker.example/?from=127.0.0.1"},
    )
    assert host.status_code == 403
    assert origin.status_code == 403


def test_query_token_is_exchanged_for_cookie_and_removed_from_url(tmp_path: Path):
    app = create_app(tmp_path / "workspace", session_token="test-token")
    test_client = TestClient(app, raise_server_exceptions=False)
    response = test_client.get(
        "/api/v1/scenes?token=test-token",
        follow_redirects=False,
    )
    assert response.status_code == 303
    assert "token=" not in response.headers["location"]
    assert "rgbd_session=" in response.headers["set-cookie"]

    authorized = test_client.get("/api/v1/scenes")
    assert authorized.status_code == 200
    assert authorized.json() == {"schema_version": 1, "scenes": []}


def test_import_probe_metadata_and_commit_flow_redacts_paths(tmp_path: Path):
    test_client = client(tmp_path)
    test_client.get("/api/v1/scenes?token=test-token", follow_redirects=False)
    # The app generates its own token; use the test app's cookie for this unit test.
    test_client.cookies.set("rgbd_session", test_client.app.state.session_cookie)

    response = test_client.post(
        "/api/v1/imports",
        files={
            "rgb": ("color.png", png_bytes(), "image/png"),
            "depth": ("depth.npy", depth_bytes(), "application/octet-stream"),
        },
    )
    assert response.status_code == 201
    payload = response.json()
    import_id = payload["import_id"]
    assert "workspace" not in json.dumps(payload)
    assert payload["capabilities"]["image_inspection"] is True
    assert payload["capabilities"]["metric_pointcloud"] is False

    metadata = {
        "display_name": "Fixture Scene",
        "representation": "z_depth",
        "unit": "mm",
        "camera": {
            "model": "pinhole",
            "width": 2,
            "height": 2,
            "fx": 10.0,
            "fy": 10.0,
            "cx": 1.0,
            "cy": 1.0,
            "distortion_model": "none",
        },
        "alignment": {"state": "registered_to_rgb"},
    }
    confirmed = test_client.put(f"/api/v1/imports/{import_id}/metadata", json=metadata)
    assert confirmed.status_code == 200
    assert confirmed.json()["capabilities"]["metric_pointcloud"] is True

    committed = test_client.post(f"/api/v1/imports/{import_id}/commit")
    assert committed.status_code == 201
    scene = committed.json()["scene"]
    assert scene["display_name"] == "Fixture Scene"
    assert "workspace" not in json.dumps(scene)
    assert "path" not in json.dumps(scene)

    listed = test_client.get("/api/v1/scenes")
    assert listed.status_code == 200
    assert listed.json()["scenes"][0]["scene_id"] == scene["scene_id"]


def test_invalid_metadata_returns_structured_diagnostic(tmp_path: Path):
    test_client = client(tmp_path)
    test_client.cookies.set("rgbd_session", test_client.app.state.session_cookie)
    response = test_client.post(
        "/api/v1/imports",
        files={
            "rgb": ("color.png", png_bytes(), "image/png"),
            "depth": ("depth.npy", depth_bytes(), "application/octet-stream"),
        },
    )
    import_id = response.json()["import_id"]
    invalid = test_client.put(
        f"/api/v1/imports/{import_id}/metadata",
        json={"representation": "z_depth", "unit": "unitless"},
    )
    assert invalid.status_code == 422
    assert invalid.json()["diagnostics"][0]["code"] == "METADATA_INVALID"


def test_upload_limit_rejects_large_multipart_before_commit(tmp_path: Path):
    test_client = client(tmp_path, max_upload_bytes=32)
    test_client.cookies.set("rgbd_session", test_client.app.state.session_cookie)
    response = test_client.post(
        "/api/v1/imports",
        files={
            "rgb": ("color.png", png_bytes(), "image/png"),
            "depth": ("depth.npy", depth_bytes(), "application/octet-stream"),
        },
    )
    assert response.status_code == 413
    assert response.json()["detail"] == "upload exceeds configured byte limit"


def test_capabilities_route_is_stable_and_does_not_read_images(tmp_path: Path):
    test_client = client(tmp_path)
    test_client.cookies.set("rgbd_session", test_client.app.state.session_cookie)
    response = test_client.get("/api/v1/capabilities")
    assert response.status_code == 200
    payload = response.json()
    assert set(payload) >= {"schema_version", "decoders", "encoders", "limits"}
    assert "workspace" not in json.dumps(payload)


def test_scene_depth_preview_returns_png_for_array_source(tmp_path: Path):
    test_client = client(tmp_path)
    test_client.cookies.set("rgbd_session", test_client.app.state.session_cookie)
    created = test_client.post(
        "/api/v1/imports",
        files={
            "rgb": ("color.png", png_bytes(), "image/png"),
            "depth": ("depth.npy", depth_bytes(), "application/octet-stream"),
        },
    )
    import_id = created.json()["import_id"]
    confirmed = test_client.put(
        f"/api/v1/imports/{import_id}/metadata",
        json={"representation": "z_depth", "unit": "mm"},
    )
    assert confirmed.status_code == 200
    committed = test_client.post(f"/api/v1/imports/{import_id}/commit")
    scene_id = committed.json()["scene"]["scene_id"]

    preview = test_client.get(f"/api/v1/scenes/{scene_id}/preview/depth")
    assert preview.status_code == 200
    assert preview.headers["content-type"].startswith("image/png")
    assert preview.content.startswith(b"\x89PNG\r\n\x1a\n")


def test_linked_scene_staleness_is_reflected_in_api_capabilities(tmp_path: Path):
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    rgb_path = source_dir / "rgb.png"
    depth_path = source_dir / "depth.npy"
    rgb_path.write_bytes(png_bytes())
    depth_path.write_bytes(depth_bytes())
    application = create_app(tmp_path / "workspace")
    store = application.state.workspace_store
    rgb = store.register_linked(rgb_path, "rgb").model_copy(update={"width": 2, "height": 2})
    depth = store.register_linked(depth_path, "depth").model_copy(update={"width": 2, "height": 2})
    from rgbd_workbench.domain.contracts import (
        AlignmentSpec,
        CameraSpec,
        DepthSpec,
        SceneManifestV1,
    )

    manifest = SceneManifestV1(
        schema_version=1,
        scene_id="linked-scene",
        display_name="Linked Scene",
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
        normalizer_version="1",
        adapter_versions={"rgb": "1", "depth": "1"},
    )
    store.commit_scene(manifest, {})
    depth_path.write_bytes(b"changed")
    test_client = TestClient(application)
    test_client.cookies.set("rgbd_session", application.state.session_cookie)
    response = test_client.get("/api/v1/scenes")
    assert response.status_code == 200
    linked = response.json()["scenes"][0]
    assert linked["capabilities"]["metric_pointcloud"] is False
    assert any(item["code"] == "LINKED_SOURCE_STALE" for item in linked["diagnostics"])


def test_manifest_upload_supplies_semantics_and_commits(tmp_path: Path):
    test_client = client(tmp_path)
    test_client.cookies.set("rgbd_session", test_client.app.state.session_cookie)
    manifest = json.dumps(
        {
            "schema_version": 1,
            "representation": "z_depth",
            "unit": "mm",
            "alignment": {"state": "registered_to_rgb"},
        }
    ).encode()
    created = test_client.post(
        "/api/v1/imports",
        files={
            "rgb": ("color.png", png_bytes(), "image/png"),
            "depth": ("depth.npy", depth_bytes(), "application/octet-stream"),
            "manifest": ("scene.json", manifest, "application/json"),
        },
    )
    assert created.status_code == 201
    import_id = created.json()["import_id"]
    committed = test_client.post(f"/api/v1/imports/{import_id}/commit")
    assert committed.status_code == 201
    assert committed.json()["scene"]["depth_spec"]["unit"] == "mm"


def test_orientation_confirmation_does_not_override_geometry_gate(tmp_path: Path):
    test_client = client(tmp_path)
    test_client.cookies.set("rgbd_session", test_client.app.state.session_cookie)
    created = test_client.post(
        "/api/v1/imports",
        files={
            "rgb": ("color.jpg", png_bytes(), "image/jpeg"),
            "depth": ("depth.npy", depth_bytes(), "application/octet-stream"),
        },
    )
    import_id = created.json()["import_id"]
    confirmed = test_client.put(
        f"/api/v1/imports/{import_id}/metadata",
        json={
            "representation": "z_depth",
            "unit": "mm",
            "orientation_confirmed": True,
            "camera": {
                "model": "pinhole",
                "width": 2,
                "height": 2,
                "fx": 10.0,
                "fy": 10.0,
                "cx": 1.0,
                "cy": 1.0,
                "distortion_model": "none",
            },
            "alignment": {"state": "registered_to_rgb"},
        },
    )
    assert confirmed.status_code == 200
