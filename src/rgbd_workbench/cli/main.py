from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
import tomllib
import zipfile
from pathlib import Path
from typing import Any

import typer
import uvicorn
from platformdirs import user_config_dir

from rgbd_workbench import APP_VERSION
from rgbd_workbench.api.app import create_app
from rgbd_workbench.workspace.store import WorkspaceStore

app = typer.Typer(help="RGB-D Lab local analysis workbench.")
workspace_app = typer.Typer(help="Create and restore portable workspaces.")
app.add_typer(workspace_app, name="workspace")


def default_config_path() -> Path:
    return Path(user_config_dir("rgbd-workbench")) / "config.toml"


def _config_workspace(config_path: Path) -> Path | None:
    if not config_path.is_file():
        return None
    try:
        with config_path.open("rb") as stream:
            payload = tomllib.load(stream)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise typer.BadParameter("config.toml is invalid") from exc
    value = payload.get("workspace_root")
    if not isinstance(value, str) or not value:
        return None
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = config_path.parent / path
    return path


def resolve_workspace_root(cli_root: Path | None, *, config_path: Path | None = None) -> Path:
    config_path = config_path or default_config_path()
    config_root = _config_workspace(config_path)
    env_root = os.environ.get("RGBD_WORKBENCH_WORKSPACE_ROOT")
    if env_root:
        env_path = Path(env_root).expanduser()
        if not env_path.is_absolute():
            env_path = config_path.parent / env_path
    else:
        env_path = None
    selected = cli_root or env_path or config_root
    if selected is None:
        selected = Path.home() / ".local" / "share" / "rgbd-workbench" / "workspace"
    return selected.resolve()


def _open_browser(url: str) -> None:
    import webbrowser

    webbrowser.open(url)


@app.command()
def serve(
    workspace_root: Path | None = typer.Option(None, "--workspace-root"),
    port: int = typer.Option(8765, min=1, max=65535),
    no_open: bool = typer.Option(False, "--no-open"),
) -> None:
    """Start the loopback-only local service."""
    root = resolve_workspace_root(workspace_root)
    application = create_app(root)
    url = f"http://127.0.0.1:{port}/?token={application.state.session_token}"
    typer.echo(f"RGB-D Lab: {url}")
    if not no_open:
        _open_browser(url)
    uvicorn.run(application, host="127.0.0.1", port=port, log_level="info")


@app.command()
def open(
    rgb: Path = typer.Option(..., exists=True, dir_okay=False),
    depth: Path = typer.Option(..., exists=True, dir_okay=False),
    manifest: Path | None = typer.Option(None, exists=True, dir_okay=False),
    link: bool = typer.Option(False, "--link"),
    workspace_root: Path | None = typer.Option(None, "--workspace-root"),
    no_open: bool = typer.Option(False, "--no-open"),
) -> None:
    """Stage an RGB/depth pair and open the local workbench."""
    root = resolve_workspace_root(workspace_root)
    store = WorkspaceStore(root)
    store.initialize()
    if link:
        rgb_source_id = store.register_linked(rgb, "rgb").source_id
        depth_source_id = store.register_linked(depth, "depth").source_id
        mode = "linked"
    else:
        with rgb.open("rb") as stream:
            staged_rgb = store.stage_bytes(rgb.name, stream, 2 * 1024 * 1024 * 1024)
        with depth.open("rb") as stream:
            staged_depth = store.stage_bytes(depth.name, stream, 2 * 1024 * 1024 * 1024)
        rgb_source_id = staged_rgb.source_id
        depth_source_id = staged_depth.source_id
        mode = "managed"
    typer.echo(
        json.dumps(
            {
                "schema_version": 1,
                "mode": mode,
                "rgb_source_id": rgb_source_id,
                "depth_source_id": depth_source_id,
                "manifest_provided": manifest is not None,
            },
            sort_keys=True,
        )
    )
    if not no_open:
        application = create_app(root)
        url = f"http://127.0.0.1:8765/?token={application.state.session_token}"
        _open_browser(url)
        typer.echo(url)


@app.command()
def doctor(
    json_output: bool = typer.Option(False, "--json"),
    workspace_root: Path | None = typer.Option(None, "--workspace-root"),
) -> None:
    """Check local runtime capabilities without reading image contents."""
    root = resolve_workspace_root(workspace_root)
    root.mkdir(parents=True, exist_ok=True)
    checks: dict[str, Any] = {
        "schema_version": 1,
        "app_version": APP_VERSION,
        "python": {
            "version": ".".join(str(value) for value in sys.version_info[:3]),
            "supported": sys.version_info >= (3, 11),
        },
        "workspace": {"writable": os.access(root, os.W_OK)},
        "frontend": {
            "built_assets": (Path(__file__).resolve().parents[3] / "dist" / "web").is_dir()
        },
        "ffmpeg": {"available": bool(os.environ.get("RGBD_WORKBENCH_FFMPEG"))},
        "limits": {"max_upload_bytes": 2 * 1024 * 1024 * 1024, "max_pixels": 64 * 1024 * 1024},
    }
    if json_output:
        typer.echo(json.dumps(checks, ensure_ascii=False, sort_keys=True))
    else:
        for section, value in checks.items():
            typer.echo(f"{section}: {value}")


@workspace_app.command("pack")
def pack_workspace(
    workspace_root: Path = typer.Option(..., "--workspace-root", exists=True, file_okay=False),
    output: Path = typer.Option(..., "--output"),
    include_linked: bool = typer.Option(False, "--include-linked"),
) -> None:
    """Pack a workspace into a validated ZIP64 archive."""
    root = workspace_root.resolve()
    members: list[tuple[str, Path]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root).as_posix()
        if relative.startswith(".staging/"):
            continue
        if "private-locators.json" in relative and not include_linked:
            continue
        members.append((relative, path))
    manifest: dict[str, Any] = {"schema_version": 1, "members": []}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.tmp")
    try:
        with zipfile.ZipFile(
            temporary,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            allowZip64=True,
        ) as archive:
            for relative, path in members:
                data = path.read_bytes()
                archive.writestr(relative, data)
                manifest["members"].append(
                    {
                        "path": relative,
                        "size": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                    }
                )
            archive.writestr(
                "archive_manifest.json",
                json.dumps(manifest, sort_keys=True, indent=2),
            )
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    typer.echo(str(output))


@workspace_app.command("unpack")
def unpack_workspace(
    archive: Path = typer.Argument(..., exists=True, dir_okay=False),
    output: Path = typer.Option(..., "--output"),
) -> None:
    """Safely unpack a workspace archive into a new directory."""
    output = output.resolve()
    if output.exists() and any(output.iterdir()):
        raise typer.BadParameter("output directory must be empty")
    output.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="rgbd-unpack-", dir=output.parent))
    try:
        with zipfile.ZipFile(archive) as source:
            names = source.namelist()
            for name in names:
                target = (temporary / name).resolve()
                if not target.is_relative_to(temporary) or name.endswith("/"):
                    raise typer.BadParameter("archive contains an unsafe path")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read(name))
        for item in temporary.iterdir():
            shutil.move(str(item), output / item.name)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)
    typer.echo(str(output))


def main() -> None:
    app()


if __name__ == "__main__":
    main()
