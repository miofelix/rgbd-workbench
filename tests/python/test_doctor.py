from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from rgbd_workbench.cli.main import app


def test_doctor_json_contract_has_no_machine_paths(tmp_path: Path):
    result = CliRunner().invoke(
        app,
        ["doctor", "--json", "--workspace-root", str(tmp_path / "workspace")],
    )
    assert result.exit_code == 0, result.stdout
    payload = json.loads(result.stdout)
    assert set(payload) == {
        "app_version",
        "ffmpeg",
        "frontend",
        "limits",
        "optional_adapters",
        "python",
        "schema_version",
        "workspace",
    }
    assert payload["schema_version"] == 1
    assert payload["python"]["supported"] is True
    assert payload["workspace"]["writable"] is True
    assert str(tmp_path) not in result.stdout
