from __future__ import annotations

import io
import json
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from rgbd_workbench.api.app import create_app


def rgb_fixture() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (2, 2), (80, 100, 120)).save(output, format="PNG")
    return output.getvalue()


def metric_depth_fixture() -> bytes:
    output = io.BytesIO()
    np.save(output, np.array([[0.2, 0.3], [0.0, 0.4]], dtype=np.float32))
    return output.getvalue()


def relative_pfm_fixture() -> bytes:
    values = np.array([[0.2, 0.4], [0.6, 0.8]], dtype="<f4")
    output = io.BytesIO(b"Pf\n2 2\n-1.0\n")
    output.write(np.flipud(values).tobytes())
    return output.getvalue()


def authorized_client(tmp_path: Path) -> TestClient:
    application = create_app(tmp_path / "workspace")
    test_client = TestClient(application)
    test_client.cookies.set("rgbd_session", application.state.session_cookie)
    return test_client


def test_metric_fixture_requires_explicit_metadata_and_preserves_input(tmp_path: Path):
    test_client = authorized_client(tmp_path)
    rgb = rgb_fixture()
    depth = metric_depth_fixture()
    response = test_client.post(
        "/api/v1/imports",
        files={
            "rgb": ("fixture.png", rgb, "image/png"),
            "depth": ("metric.npy", depth, "application/octet-stream"),
        },
    )
    assert response.status_code == 201
    import_id = response.json()["import_id"]
    confirmed = test_client.put(
        f"/api/v1/imports/{import_id}/metadata",
        json={
            "representation": "z_depth",
            "unit": "m",
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
    assert confirmed.json()["capabilities"]["metric_pointcloud"] is True
    committed = test_client.post(f"/api/v1/imports/{import_id}/commit")
    assert committed.status_code == 201
    assert "metric.npy" in committed.text
    assert str(tmp_path) not in committed.text
    assert rgb == rgb_fixture()
    assert depth == metric_depth_fixture()


def test_relative_fixture_stays_unitless_and_metric_is_disabled(tmp_path: Path):
    test_client = authorized_client(tmp_path)
    response = test_client.post(
        "/api/v1/imports",
        files={
            "rgb": ("fixture.png", rgb_fixture(), "image/png"),
            "depth": ("relative.pfm", relative_pfm_fixture(), "application/octet-stream"),
        },
    )
    import_id = response.json()["import_id"]
    confirmed = test_client.put(
        f"/api/v1/imports/{import_id}/metadata",
        json={"representation": "relative_z", "unit": "unitless"},
    )
    assert confirmed.status_code == 200
    payload = confirmed.json()
    assert payload["scene"]["depth_spec"]["unit"] == "unitless"
    assert payload["capabilities"]["metric_pointcloud"] is False
    assert payload["capabilities"]["video_export"] is False
    assert str(tmp_path) not in json.dumps(payload)
