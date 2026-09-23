from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

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
