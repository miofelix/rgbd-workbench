from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
import tomllib
import zipfile
from importlib.util import find_spec
from pathlib import Path
from typing import Any

import imageio_ffmpeg  # type: ignore[import-untyped]
import typer
import uvicorn
from platformdirs import user_config_dir

from rgbd_workbench import APP_VERSION
from rgbd_workbench.api.app import create_app, seed_import_from_paths

app = typer.Typer(help="RGB-D Lab local analysis workbench.")
workspace_app = typer.Typer(help="Create and restore portable workspaces.")
app.add_typer(workspace_app, name="workspace")

MAX_ARCHIVE_MEMBERS = 10_000
MAX_ARCHIVE_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
MAX_ARCHIVE_MEMBER_BYTES = 2 * 1024 * 1024 * 1024


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


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


@app.command()
def serve(
    workspace_root: Path | None = typer.Option(None, "--workspace-root"),
    port: int = typer.Option(8765, min=1, max=65535),
    no_open: bool = typer.Option(False, "--no-open"),
) -> None:
    """Start the loopback-only local service."""
    root = resolve_workspace_root(workspace_root)
    application = create_app(root, session_token=os.environ.get("RGBD_WORKBENCH_SESSION_TOKEN"))
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
    application = create_app(
        root,
        session_token=os.environ.get("RGBD_WORKBENCH_SESSION_TOKEN"),
    )
    import_id = seed_import_from_paths(application, rgb, depth, manifest, linked=link)
    url = f"http://127.0.0.1:8765/?token={application.state.session_token}&import={import_id}"
    typer.echo(
        json.dumps(
            {
                "schema_version": 1,
                "import_id": import_id,
                "mode": "linked" if link else "managed",
            }
        )
    )
    if not no_open:
        _open_browser(url)
    typer.echo(url)
    uvicorn.run(application, host="127.0.0.1", port=8765, log_level="info")


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
        "ffmpeg": {
            "available": bool(
                os.environ.get("RGBD_WORKBENCH_FFMPEG") or imageio_ffmpeg.get_ffmpeg_exe()
            )
        },
        "optional_adapters": {"exr": find_spec("OpenEXR") is not None},
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
    overrides: dict[str, bytes] = {}
    skipped: set[str] = set()
    for locator_path in root.rglob("private-locators.json"):
        relative_locator = locator_path.relative_to(root).as_posix()
        skipped.add(relative_locator)
        if not include_linked:
            continue
        scene_dir = locator_path.parent
        scene_path = scene_dir / "scene.json"
        locators = json.loads(locator_path.read_text(encoding="utf-8"))
        scene_payload = json.loads(scene_path.read_text(encoding="utf-8"))
        for role, locator in locators.items():
            linked_path = Path(locator["path"])
            if not linked_path.is_file():
                raise typer.BadParameter(f"linked source is missing: {role}")
            target_name = f"linked-{role}-{linked_path.name}"
            target_relative = (scene_dir / "sources" / target_name).relative_to(root).as_posix()
            overrides[target_relative] = linked_path.read_bytes()
            if role in scene_payload:
                scene_payload[role]["filename"] = target_name
        overrides[scene_path.relative_to(root).as_posix()] = (
            json.dumps(scene_payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        ).encode("utf-8")
    members: list[tuple[str, Path]] = []
    output_resolved = output.resolve()
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        if path.resolve() == output_resolved:
            continue
        relative = path.relative_to(root).as_posix()
        if relative.startswith(".staging/"):
            continue
        if relative in skipped or "private-locators.json" in relative:
            continue
        if relative in overrides:
            continue
        members.append((relative, path))
    virtual_members = [(relative, None, data) for relative, data in overrides.items()]
    archive_members: list[tuple[str, Path | None, bytes | None]] = [
        *[(relative, path, None) for relative, path in members],
        *virtual_members,
    ]
    if len(archive_members) > MAX_ARCHIVE_MEMBERS:
        raise typer.BadParameter("workspace has too many archive members")
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
            total_bytes = 0
            for relative, member_path, data in archive_members:
                size = member_path.stat().st_size if member_path is not None else len(data or b"")
                if size > MAX_ARCHIVE_MEMBER_BYTES or total_bytes + size > MAX_ARCHIVE_TOTAL_BYTES:
                    raise typer.BadParameter("workspace exceeds archive size limits")
                if member_path is not None:
                    archive.write(member_path, arcname=relative)
                    digest = _sha256_file(member_path)
                else:
                    archive.writestr(relative, data or b"")
                    digest = hashlib.sha256(data or b"").hexdigest()
                total_bytes += size
                manifest["members"].append(
                    {
                        "path": relative,
                        "size": size,
                        "sha256": digest,
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
            if len(names) > MAX_ARCHIVE_MEMBERS:
                raise typer.BadParameter("archive has too many members")
            if "archive_manifest.json" not in names:
                raise typer.BadParameter("archive manifest is missing")
            expected = json.loads(source.read("archive_manifest.json"))
            expected_members = {item["path"]: item for item in expected.get("members", [])}
            seen: set[str] = set()
            total_bytes = 0
            for info in source.infolist():
                name = info.filename
                if name == "archive_manifest.json":
                    continue
                normalized = Path(name).as_posix()
                if (
                    normalized in seen
                    or normalized.startswith("/")
                    or ".." in Path(normalized).parts
                ):
                    raise typer.BadParameter("archive contains an unsafe or duplicate path")
                if info.is_dir() or (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise typer.BadParameter("archive contains a directory or symlink member")
                if info.file_size > MAX_ARCHIVE_MEMBER_BYTES:
                    raise typer.BadParameter("archive member exceeds size limits")
                total_bytes += info.file_size
                if total_bytes > MAX_ARCHIVE_TOTAL_BYTES:
                    raise typer.BadParameter("archive exceeds total size limits")
                seen.add(normalized)
                target = (temporary / name).resolve()
                if not target.is_relative_to(temporary) or name.endswith("/"):
                    raise typer.BadParameter("archive contains an unsafe path")
                target.parent.mkdir(parents=True, exist_ok=True)
                digest = hashlib.sha256()
                with source.open(info) as input_stream, target.open("wb") as output_stream:
                    while chunk := input_stream.read(1024 * 1024):
                        digest.update(chunk)
                        output_stream.write(chunk)
                expected_item = expected_members.get(normalized)
                if (
                    expected_item is None
                    or expected_item.get("size") != info.file_size
                    or expected_item.get("sha256") != digest.hexdigest()
                ):
                    raise typer.BadParameter("archive member hash verification failed")
        for item in temporary.iterdir():
            shutil.move(str(item), output / item.name)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)
    typer.echo(str(output))


def main() -> None:
    app()


if __name__ == "__main__":
    main()
