from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from rgbd_workbench.api.app import create_app
from rgbd_workbench.processing.protocol import decode_pointcloud


def rgb_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (2, 2), (20, 40, 60)).save(output, format="PNG")
    return output.getvalue()


def depth_bytes() -> bytes:
    output = io.BytesIO()
    np.save(output, np.array([[0.2, 0.3], [0.4, 0.5]], dtype=np.float32))
    return output.getvalue()


def authorized_client(tmp_path: Path) -> TestClient:
    application = create_app(tmp_path / "workspace")
    client = TestClient(application, raise_server_exceptions=False)
    client.cookies.set("rgbd_session", application.state.session_cookie)
    return client


def create_scene(
    client: TestClient,
    *,
    representation: str = "z_depth",
    unit: str = "m",
    geometry: bool = True,
) -> str:
    response = client.post(
        "/api/v1/imports",
        files={
            "rgb": ("color.png", rgb_bytes(), "image/png"),
            "depth": ("depth.npy", depth_bytes(), "application/octet-stream"),
        },
    )
    assert response.status_code == 201
    import_id = response.json()["import_id"]
    metadata: dict[str, object] = {"representation": representation, "unit": unit}
    if geometry:
        metadata.update(
            {
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
        )
    confirmed = client.put(f"/api/v1/imports/{import_id}/metadata", json=metadata)
    assert confirmed.status_code == 200
    committed = client.post(f"/api/v1/imports/{import_id}/commit")
    assert committed.status_code == 201
    return committed.json()["scene"]["scene_id"]


def test_derivation_post_is_idempotent_and_downloads_exports(tmp_path: Path):
    client = authorized_client(tmp_path)
    scene_id = create_scene(client)

    first = client.post(f"/api/v1/scenes/{scene_id}/derivations", json={"schema_version": 1})
    second = client.post(f"/api/v1/scenes/{scene_id}/derivations", json={"schema_version": 1})

    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json()["cached"] is True
    first_payload = first.json()
    derivation_id = first_payload["derivation"]["derivation_id"]
    assert str(tmp_path) not in json.dumps(first_payload)
    assert first_payload["urls"]["pointcloud"].endswith(f"/derivations/{derivation_id}/pointcloud")

    binary = client.get(f"/api/v1/derivations/{derivation_id}/pointcloud")
    assert binary.status_code == 200
    assert binary.headers["content-type"].startswith("application/vnd.rgbd-workbench.pointcloud-v1")
    assert decode_pointcloud(binary.content).manifest.point_count == 4

    ply = client.get(f"/api/v1/derivations/{derivation_id}/export/ply")
    document = client.get(f"/api/v1/derivations/{derivation_id}/export/json")
    assert ply.status_code == 200 and ply.content.startswith(b"ply\n")
    assert document.status_code == 200
    assert document.headers["content-type"].startswith("application/json")
    assert document.json()["derivation_key"] == first_payload["derivation"]["derivation_key"]

    fetched = client.get(f"/api/v1/derivations/{derivation_id}")
    assert fetched.status_code == 200
    assert fetched.json()["derivation"]["derivation_id"] == derivation_id


def test_derivation_is_blocked_for_missing_geometry_metadata(tmp_path: Path):
    client = authorized_client(tmp_path)
    scene_id = create_scene(client, geometry=False)

    response = client.post(f"/api/v1/scenes/{scene_id}/derivations", json={"schema_version": 1})

    assert response.status_code == 422
    assert response.json()["diagnostics"][0]["code"] == "DERIVATION_CAPABILITY_BLOCKED"


def test_relative_scene_derivation_stays_unitless(tmp_path: Path):
    client = authorized_client(tmp_path)
    scene_id = create_scene(client, representation="relative_z", unit="unitless")

    response = client.post(f"/api/v1/scenes/{scene_id}/derivations", json={"schema_version": 1})

    assert response.status_code == 201
    derivation = response.json()["derivation"]
    assert derivation["unit"] == "unitless"
    assert derivation["representation"] == "relative_z"
    binary = client.get(response.json()["urls"]["pointcloud"])
    assert decode_pointcloud(binary.content).manifest.unit == "unitless"


def test_stale_source_never_reuses_a_previous_derivation(tmp_path: Path):
    client = authorized_client(tmp_path)
    scene_id = create_scene(client)
    first = client.post(f"/api/v1/scenes/{scene_id}/derivations", json={"schema_version": 1})
    assert first.status_code == 201
    depth_path = client.app.state.workspace_store.resolve_scene_source(scene_id, "depth")
    depth_path.write_bytes(b"changed")

    response = client.post(f"/api/v1/scenes/{scene_id}/derivations", json={"schema_version": 1})

    assert response.status_code == 422
    assert response.json()["diagnostics"][0]["code"] == "SCENE_SOURCE_STALE"


def test_stale_source_blocks_existing_derivation_download(tmp_path: Path):
    client = authorized_client(tmp_path)
    scene_id = create_scene(client)
    created = client.post(f"/api/v1/scenes/{scene_id}/derivations", json={"schema_version": 1})
    derivation_id = created.json()["derivation"]["derivation_id"]
    depth_path = client.app.state.workspace_store.resolve_scene_source(scene_id, "depth")
    depth_path.write_bytes(b"changed")

    response = client.get(f"/api/v1/derivations/{derivation_id}/pointcloud")

    assert response.status_code == 409
    assert response.json()["diagnostics"][0]["code"] == "SCENE_SOURCE_STALE"
