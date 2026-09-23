from __future__ import annotations

import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image
from typer.testing import CliRunner

from rgbd_workbench.api.app import create_app, seed_import_from_paths
from rgbd_workbench.cli.main import app, resolve_workspace_root


def test_cli_help_exposes_public_commands():
    result = CliRunner().invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "serve" in result.stdout
    assert "open" in result.stdout
    assert "doctor" in result.stdout
    assert "workspace" in result.stdout


def test_workspace_root_precedence_is_cli_over_environment_over_config(tmp_path: Path, monkeypatch):
    config = tmp_path / "config.toml"
    config.write_text('workspace_root = "config-root"\n', encoding="utf-8")
    monkeypatch.setenv("RGBD_WORKBENCH_WORKSPACE_ROOT", "env-root")
    assert (
        resolve_workspace_root(tmp_path / "cli-root", config_path=config)
        == (tmp_path / "cli-root").resolve()
    )
    assert resolve_workspace_root(None, config_path=config) == (tmp_path / "env-root").resolve()


def test_doctor_json_has_stable_redacted_fields(tmp_path: Path):
    result = CliRunner().invoke(app, ["doctor", "--json", "--workspace-root", str(tmp_path / "w")])
    assert result.exit_code == 0, result.stdout
    payload = json.loads(result.stdout)
    assert set(payload) >= {"schema_version", "python", "workspace", "frontend", "ffmpeg", "limits"}
    assert str(tmp_path) not in result.stdout


def test_workspace_pack_round_trip_verifies_members(tmp_path: Path):
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "workspace.json").write_text('{"schema_version":1}', encoding="utf-8")
    source = root / "note.txt"
    source.write_text("hello", encoding="utf-8")
    archive = tmp_path / "workspace.rgbdw"
    result = CliRunner().invoke(
        app,
        ["workspace", "pack", "--workspace-root", str(root), "--output", str(archive)],
    )
    assert result.exit_code == 0, result.stdout
    restored = tmp_path / "restored"
    result = CliRunner().invoke(
        app,
        ["workspace", "unpack", str(archive), "--output", str(restored)],
    )
    assert result.exit_code == 0, result.stdout
    assert (restored / "note.txt").read_text(encoding="utf-8") == "hello"


def test_workspace_unpack_rejects_traversal_archive(tmp_path: Path):
    archive = tmp_path / "unsafe.rgbdw"
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("../escape.txt", "bad")
    result = CliRunner().invoke(
        app,
        ["workspace", "unpack", str(archive), "--output", str(tmp_path / "restored")],
    )
    assert result.exit_code != 0


def test_workspace_unpack_rejects_tampered_member(tmp_path: Path):
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "note.txt").write_text("hello", encoding="utf-8")
    archive = tmp_path / "workspace.rgbdw"
    assert (
        CliRunner()
        .invoke(
            app,
            ["workspace", "pack", "--workspace-root", str(root), "--output", str(archive)],
        )
        .exit_code
        == 0
    )
    tampered = tmp_path / "tampered.rgbdw"
    with zipfile.ZipFile(archive) as source, zipfile.ZipFile(tampered, "w") as output:
        for item in source.infolist():
            output.writestr(
                item.filename,
                b"changed" if item.filename == "note.txt" else source.read(item),
            )
    result = CliRunner().invoke(
        app,
        ["workspace", "unpack", str(tampered), "--output", str(tmp_path / "restored")],
    )
    assert result.exit_code != 0


def test_workspace_unpack_rejects_extreme_compression_ratio(tmp_path: Path):
    archive = tmp_path / "ratio.rgbdw"
    payload = b"a" * (2 * 1024 * 1024)
    import hashlib

    manifest = {
        "schema_version": 1,
        "members": [
            {
                "path": "large.txt",
                "size": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
        ],
    }
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
        output.writestr("large.txt", payload)
        output.writestr("archive_manifest.json", json.dumps(manifest))
    result = CliRunner().invoke(
        app,
        ["workspace", "unpack", str(archive), "--output", str(tmp_path / "restored")],
    )
    assert result.exit_code != 0


def test_cli_seeded_import_is_recoverable_by_browser_session(tmp_path: Path):
    rgb = tmp_path / "rgb.png"
    depth = tmp_path / "depth.npy"
    Image.new("RGB", (2, 2), (1, 2, 3)).save(rgb)
    depth.write_bytes(b"not-decoded-yet")
    application = create_app(tmp_path / "workspace", session_token="seed-token")
    import_id = seed_import_from_paths(application, rgb, depth)
    browser = TestClient(application)
    response = browser.get(f"/api/v1/imports/{import_id}?token=seed-token")
    assert response.status_code == 200
    assert response.json()["import_id"] == import_id
