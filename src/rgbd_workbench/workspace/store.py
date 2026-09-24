from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Literal

from pydantic import ValidationError

from rgbd_workbench.domain.canonical import canonical_json_bytes
from rgbd_workbench.domain.contracts import DerivationManifestV1, SceneManifestV1, SourceRef
from rgbd_workbench.domain.diagnostics import Diagnostic
from rgbd_workbench.processing.protocol import decode_pointcloud, validate_ply
from rgbd_workbench.workspace.paths import WorkspacePaths

_SAFE_SCENE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$")
_SAFE_DERIVATION_KEY = re.compile(r"^[a-f0-9]{64}$")
_CHUNK_SIZE = 1024 * 1024
_DERIVATION_FILES = frozenset(
    {"manifest.json", "pointcloud.bin", "pointcloud.ply", "parameters.json"}
)
_DERIVATION_INTEGRITY_FILE = ".integrity.json"
_DERIVATION_CACHE_FILES = _DERIVATION_FILES | {_DERIVATION_INTEGRITY_FILE}


@dataclass(frozen=True, slots=True)
class StagedFile:
    source_id: str
    filename: str
    safe_name: str
    path: Path
    sha256: str
    size_bytes: int


class SceneSourceError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(f"{code}: {message}")


@dataclass(frozen=True, slots=True)
class CachedDerivation:
    directory: Path
    manifest: DerivationManifestV1

    def path(self, name: str) -> Path:
        if name not in _DERIVATION_FILES:
            raise ValueError("unsupported derivation file")
        return self.directory / name

    def __getitem__(self, name: str) -> bytes:
        return self.path(name).read_bytes()


class WorkspaceStore:
    def __init__(self, root: Path) -> None:
        self.paths = WorkspacePaths(root)
        self._linked_sources: dict[str, tuple[str, Path, os.stat_result]] = {}

    def initialize(self) -> None:
        self.paths.initialize()
        workspace_file = self.paths.resolve_write_path("workspace.json")
        if not workspace_file.exists():
            self._atomic_write(workspace_file, canonical_json_bytes({"schema_version": 1}))

    def stage_bytes(self, name: str, data: BinaryIO, max_bytes: int) -> StagedFile:
        self.initialize()
        if max_bytes < 0:
            raise ValueError("max_bytes must be non-negative")
        filename = Path(name.replace("\\", "/")).name.strip() or "source.bin"
        safe_name = self._safe_filename(filename)
        source_id = secrets.token_hex(16)
        target = self.paths.resolve_write_path(Path(".staging") / f"{source_id}-{safe_name}")
        temp_path: Path | None = None
        total = 0
        digest = hashlib.sha256()
        try:
            fd, temp_name = tempfile.mkstemp(
                prefix=f".{source_id}.", suffix=".tmp", dir=target.parent
            )
            temp_path = Path(temp_name)
            with os.fdopen(fd, "wb") as output:
                while chunk := data.read(_CHUNK_SIZE):
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError(f"input exceeds byte limit of {max_bytes}")
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temp_path, target)
            temp_path = None
            self._fsync_directory(target.parent)
            return StagedFile(
                source_id=source_id,
                filename=filename,
                safe_name=safe_name,
                path=target,
                sha256=digest.hexdigest(),
                size_bytes=total,
            )
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

    def register_linked(
        self,
        path: Path,
        role: Literal["rgb", "depth", "manifest"],
    ) -> SourceRef:
        resolved = path.expanduser().resolve(strict=True)
        if not resolved.is_file():
            raise ValueError("linked source must be a regular file")
        self._reject_linked_symlink_escape(path, resolved)
        digest = self._hash_file(resolved)
        size = resolved.stat().st_size
        source = SourceRef(
            role=role,
            source_id=secrets.token_hex(16),
            filename=resolved.name,
            sha256=digest,
            size_bytes=size,
            width=None,
            height=None,
        )
        self._linked_sources[source.source_id] = (role, resolved, resolved.stat())
        return source

    def commit_scene(
        self,
        manifest: SceneManifestV1,
        staged: Mapping[str, StagedFile],
    ) -> SceneManifestV1:
        self.initialize()
        scene_id = manifest.scene_id
        if not _SAFE_SCENE_ID.fullmatch(scene_id):
            raise ValueError("scene_id contains unsupported path characters")
        scene_dir = self.paths.resolve_write_path(Path("scenes") / scene_id)
        if scene_dir.exists():
            raise FileExistsError(f"scene already exists: {scene_id}")
        temp_dir = scene_dir.parent / f".{scene_id}.{secrets.token_hex(8)}.tmp"
        self.paths._assert_inside_root(temp_dir)
        source_manifest = manifest.model_copy(deep=True)
        try:
            temp_dir.mkdir(parents=True)
            managed_dir = temp_dir / "sources"
            managed_dir.mkdir()
            (temp_dir / "cache").mkdir()
            source_refs = {"rgb": source_manifest.rgb, "depth": source_manifest.depth}
            linked_locators: dict[str, dict[str, str | int]] = {}
            for role, staged_file in staged.items():
                if role not in source_refs:
                    raise ValueError(f"unsupported managed source role: {role}")
                expected = source_refs[role]
                if (
                    expected.source_id != staged_file.source_id
                    or expected.sha256 != staged_file.sha256
                ):
                    raise ValueError(f"staged source does not match {role} manifest reference")
                staged_path = staged_file.path.resolve(strict=True)
                self.paths._assert_inside_root(staged_path)
                actual_hash = self._hash_file(staged_path)
                if (
                    actual_hash != staged_file.sha256
                    or staged_path.stat().st_size != staged_file.size_bytes
                ):
                    raise ValueError(f"staged {role} source changed before commit")
                target_name = f"{role}-{staged_file.safe_name}"
                target = managed_dir / target_name
                shutil.copyfile(staged_path, target)
                copied_hash = self._hash_file(target)
                if copied_hash != staged_file.sha256:
                    raise OSError(f"managed {role} copy failed hash verification")
                source_refs[role] = expected.model_copy(update={"filename": target_name})
            for role, source in source_refs.items():
                if role in staged:
                    continue
                linked = self._linked_sources.get(source.source_id)
                if linked is None or linked[0] != role:
                    raise ValueError(f"{role} source must be staged or registered as Linked")
                locator = linked[1]
                if not locator.is_file():
                    raise FileNotFoundError(f"linked {role} source is missing")
                current_stat = locator.stat()
                if (
                    current_stat.st_size != source.size_bytes
                    or self._hash_file(locator) != source.sha256
                ):
                    raise ValueError(f"linked {role} source changed before commit")
                registered_stat = linked[2]
                linked_locators[role] = {
                    "path": str(locator),
                    "device": registered_stat.st_dev,
                    "inode": registered_stat.st_ino,
                    "size": registered_stat.st_size,
                    "mtime_ns": registered_stat.st_mtime_ns,
                    "sha256": source.sha256,
                }
            source_manifest = source_manifest.model_copy(
                update={"rgb": source_refs["rgb"], "depth": source_refs["depth"]}
            )
            self._atomic_write(
                temp_dir / "scene.json",
                canonical_json_bytes(source_manifest),
            )
            if linked_locators:
                self._atomic_write(
                    temp_dir / "private-locators.json",
                    json.dumps(
                        linked_locators,
                        ensure_ascii=False,
                        allow_nan=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ).encode("utf-8"),
                )
            for directory in (managed_dir, temp_dir / "cache", temp_dir):
                self._fsync_directory(directory)
            os.replace(temp_dir, scene_dir)
            self._fsync_directory(scene_dir.parent)
            for staged_file in staged.values():
                staged_file.path.unlink(missing_ok=True)
            return source_manifest
        except Exception:
            if temp_dir.exists():
                shutil.rmtree(temp_dir)
            raise

    def scene_source_path(self, scene_id: str, role: Literal["rgb", "depth"]) -> Path:
        """Return the managed source path for test/tooling inspection."""
        manifest = self.get_scene(scene_id)
        source = manifest.rgb if role == "rgb" else manifest.depth
        return self.paths.resolve_write_path(
            Path("scenes") / scene_id / "sources" / source.filename
        )

    def resolve_scene_source(self, scene_id: str, role: Literal["rgb", "depth"]) -> Path:
        """Resolve and revalidate one Scene source without exposing its locator."""
        manifest = self.get_scene(scene_id)
        source = manifest.rgb if role == "rgb" else manifest.depth
        managed_path = self.paths.resolve_write_path(
            Path("scenes") / scene_id / "sources" / source.filename
        )
        if managed_path.exists() or managed_path.is_symlink():
            if managed_path.is_symlink() or not managed_path.is_file():
                raise SceneSourceError("SCENE_SOURCE_STALE", "managed source is not a regular file")
            actual_hash = self._hash_file(managed_path)
            if managed_path.stat().st_size != source.size_bytes or actual_hash != source.sha256:
                raise SceneSourceError("SCENE_SOURCE_STALE", "managed source identity changed")
            return managed_path

        locator = self._read_linked_locator(scene_id, role)
        if locator is None:
            raise SceneSourceError("SCENE_SOURCE_MISSING", "managed source is missing")
        path_value = locator.get("path")
        if not isinstance(path_value, str):
            raise SceneSourceError(
                "LINKED_SOURCE_METADATA_INVALID", "linked source metadata is invalid"
            )
        linked_path = Path(path_value)
        if not linked_path.is_file():
            raise SceneSourceError("LINKED_SOURCE_MISSING", "linked source is missing")
        linked_stat = linked_path.stat()
        identity_matches = (
            linked_stat.st_dev == locator.get("device")
            and linked_stat.st_ino == locator.get("inode")
            and linked_stat.st_size == locator.get("size") == source.size_bytes
            and linked_stat.st_mtime_ns == locator.get("mtime_ns")
        )
        if not identity_matches or self._hash_file(linked_path) != source.sha256:
            raise SceneSourceError("LINKED_SOURCE_STALE", "linked source identity changed")
        return linked_path.resolve(strict=True)

    def snapshot_scene_source(
        self,
        scene_id: str,
        role: Literal["rgb", "depth"],
        directory: Path,
    ) -> Path:
        """Copy one verified source into an immutable per-request snapshot."""
        self.paths._assert_inside_root(directory)
        manifest = self.get_scene(scene_id)
        source = manifest.rgb if role == "rgb" else manifest.depth
        source_path = self.resolve_scene_source(scene_id, role)
        destination = directory / f"{role}-{Path(source.filename).name}"
        digest = hashlib.sha256()
        total = 0
        try:
            with source_path.open("rb") as input_file, destination.open("xb") as output_file:
                before = os.fstat(input_file.fileno())
                while chunk := input_file.read(_CHUNK_SIZE):
                    digest.update(chunk)
                    total += len(chunk)
                    output_file.write(chunk)
                output_file.flush()
                os.fsync(output_file.fileno())
                after = os.fstat(input_file.fileno())
        except OSError as exc:
            destination.unlink(missing_ok=True)
            raise SceneSourceError(
                "SCENE_SOURCE_STALE", "source snapshot could not be read"
            ) from exc
        identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        if (
            identity_before != identity_after
            or total != source.size_bytes
            or digest.hexdigest() != source.sha256
        ):
            destination.unlink(missing_ok=True)
            raise SceneSourceError("SCENE_SOURCE_STALE", "source changed while being snapshotted")
        self.resolve_scene_source(scene_id, role)
        return destination

    def derivation_dir(self, scene_id: str, derivation_key: str) -> Path:
        if not _SAFE_SCENE_ID.fullmatch(scene_id):
            raise ValueError("scene id is invalid")
        if not _SAFE_DERIVATION_KEY.fullmatch(derivation_key):
            raise ValueError("derivation key is invalid")
        return self.paths.resolve_write_path(Path("scenes") / scene_id / "cache" / derivation_key)

    def read_cached_derivation(self, scene_id: str, derivation_key: str) -> CachedDerivation | None:
        directory = self.derivation_dir(scene_id, derivation_key)
        if not directory.exists():
            return None
        try:
            cached = self._load_cached_derivation(directory, scene_id, derivation_key)
        except (OSError, ValueError, ValidationError):
            self._remove_cache_directory(directory)
            return None
        return cached

    def publish_derivation(
        self,
        scene_id: str,
        derivation_key: str,
        files: Mapping[str, bytes],
    ) -> None:
        self.initialize()
        self.get_scene(scene_id)
        self.resolve_scene_source(scene_id, "rgb")
        self.resolve_scene_source(scene_id, "depth")
        target = self.derivation_dir(scene_id, derivation_key)
        if set(files) != _DERIVATION_FILES:
            raise ValueError("derivation files are incomplete")
        if target.exists():
            if self.read_cached_derivation(scene_id, derivation_key) is not None:
                return
            if target.exists():
                raise ValueError("derivation cache could not be replaced")
        target.parent.mkdir(parents=True, exist_ok=True)
        self.paths._assert_inside_root(target.parent)
        temp_dir = target.parent / f".{derivation_key}.{secrets.token_hex(8)}.tmp"
        try:
            temp_dir.mkdir(parents=True)
            for name, data in files.items():
                self._atomic_write(temp_dir / name, data)
            self._atomic_write(
                temp_dir / _DERIVATION_INTEGRITY_FILE,
                self._derivation_integrity(files),
            )
            self._load_cached_derivation(temp_dir, scene_id, derivation_key)
            self._fsync_directory(temp_dir)
            os.replace(temp_dir, target)
            self._fsync_directory(target.parent)
        finally:
            if temp_dir.exists():
                shutil.rmtree(temp_dir)

    def _load_cached_derivation(
        self, directory: Path, scene_id: str, derivation_key: str
    ) -> CachedDerivation:
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError("derivation cache directory is invalid")
        cache_paths = {name: directory / name for name in _DERIVATION_CACHE_FILES}
        if any(path.is_symlink() or not path.is_file() for path in cache_paths.values()):
            raise ValueError("derivation cache files are incomplete")
        paths = {name: cache_paths[name] for name in _DERIVATION_FILES}
        self._validate_derivation_integrity(cache_paths[_DERIVATION_INTEGRITY_FILE], paths)
        manifest = DerivationManifestV1.model_validate_json(paths["manifest.json"].read_bytes())
        if (
            manifest.scene_id != scene_id
            or manifest.derivation_key != derivation_key
            or manifest.derivation_id != f"derivation-{derivation_key}"
        ):
            raise ValueError("derivation key or scene id does not match cache")
        binary = decode_pointcloud(paths["pointcloud.bin"].read_bytes())
        if binary.manifest != manifest:
            raise ValueError("point-cloud manifest does not match cache manifest")
        parameters = DerivationManifestV1.model_validate_json(paths["parameters.json"].read_bytes())
        if parameters != manifest:
            raise ValueError("parameter manifest does not match cache manifest")
        validate_ply(paths["pointcloud.ply"].read_bytes(), manifest)
        return CachedDerivation(directory=directory, manifest=manifest)

    @staticmethod
    def _derivation_integrity(files: Mapping[str, bytes]) -> bytes:
        return canonical_json_bytes(
            {
                "schema_version": 1,
                "artifacts": {
                    name: {
                        "size_bytes": len(files[name]),
                        "sha256": hashlib.sha256(files[name]).hexdigest(),
                    }
                    for name in sorted(_DERIVATION_FILES)
                },
            }
        )

    def _validate_derivation_integrity(
        self,
        integrity_path: Path,
        artifact_paths: Mapping[str, Path],
    ) -> None:
        try:
            payload = json.loads(integrity_path.read_bytes())
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("derivation integrity metadata is invalid") from exc
        if not isinstance(payload, dict) or set(payload) != {"schema_version", "artifacts"}:
            raise ValueError("derivation integrity metadata is invalid")
        artifacts = payload.get("artifacts")
        if payload.get("schema_version") != 1 or not isinstance(artifacts, dict):
            raise ValueError("derivation integrity metadata is invalid")
        if set(artifacts) != _DERIVATION_FILES:
            raise ValueError("derivation integrity metadata is incomplete")
        for name, path in artifact_paths.items():
            expected = artifacts.get(name)
            if not isinstance(expected, dict) or set(expected) != {"size_bytes", "sha256"}:
                raise ValueError("derivation artifact integrity is invalid")
            size = expected.get("size_bytes")
            sha256 = expected.get("sha256")
            if (
                not isinstance(size, int)
                or isinstance(size, bool)
                or size < 0
                or not isinstance(sha256, str)
                or _SAFE_DERIVATION_KEY.fullmatch(sha256) is None
                or path.stat().st_size != size
                or self._hash_file(path) != sha256
            ):
                raise ValueError("derivation artifact integrity does not match cache")

    def _remove_cache_directory(self, directory: Path) -> None:
        if directory.is_symlink():
            directory.unlink(missing_ok=True)
        elif directory.is_dir():
            shutil.rmtree(directory)

    def get_scene(self, scene_id: str) -> SceneManifestV1:
        path = self._scene_file(scene_id)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            return SceneManifestV1.model_validate(payload)
        except (OSError, json.JSONDecodeError, ValidationError) as exc:
            raise ValueError(f"scene manifest is invalid: {scene_id}") from exc

    def list_scenes(self) -> list[SceneManifestV1]:
        self.initialize()
        scenes: list[SceneManifestV1] = []
        for path in sorted(self.paths.scenes.iterdir()):
            if (
                path.is_dir()
                and _SAFE_SCENE_ID.fullmatch(path.name)
                and (path / "scene.json").is_file()
            ):
                scenes.append(self.get_scene(path.name))
        return scenes

    def revalidate_scene(self, scene_id: str) -> list[Diagnostic]:
        manifest = self.get_scene(scene_id)
        scene_dir = self.paths.resolve_write_path(Path("scenes") / scene_id)
        diagnostics: list[Diagnostic] = []
        for role, source in (("rgb", manifest.rgb), ("depth", manifest.depth)):
            source_path = scene_dir / "sources" / source.filename
            if source_path.is_file():
                actual_hash = self._hash_file(source_path)
                if source_path.stat().st_size != source.size_bytes or actual_hash != source.sha256:
                    diagnostics.append(
                        Diagnostic(
                            code="SCENE_SOURCE_STALE",
                            severity="fatal",
                            field=f"{role}.source",
                            message="Managed source differs from the committed Scene summary.",
                            hint="Re-import the changed source to create a new Scene revision.",
                            capability=None,
                        )
                    )
                continue

            locator = self._read_linked_locator(scene_id, role)
            if locator is None:
                diagnostics.append(
                    Diagnostic(
                        code="SCENE_SOURCE_MISSING",
                        severity="fatal",
                        field=f"{role}.source",
                        message="Scene source is missing from the workspace.",
                        hint="Restore the managed source or re-import it.",
                        capability=None,
                    )
                )
                continue
            path_value = locator["path"]
            if not isinstance(path_value, str):
                diagnostics.append(
                    Diagnostic(
                        code="LINKED_SOURCE_METADATA_INVALID",
                        severity="fatal",
                        field=f"{role}.source",
                        message="Linked source metadata is invalid.",
                        hint="Re-link the source with the CLI.",
                        capability=None,
                    )
                )
                continue
            linked_path = Path(path_value)
            if not linked_path.is_file():
                diagnostics.append(
                    Diagnostic(
                        code="LINKED_SOURCE_MISSING",
                        severity="fatal",
                        field=f"{role}.source",
                        message="Linked source file is missing.",
                        hint="Re-link the source with the CLI.",
                        capability=None,
                    )
                )
                continue
            linked_stat = linked_path.stat()
            identity_matches = (
                linked_stat.st_dev == locator.get("device")
                and linked_stat.st_ino == locator.get("inode")
                and linked_stat.st_size == locator.get("size") == source.size_bytes
                and linked_stat.st_mtime_ns == locator.get("mtime_ns")
            )
            if not identity_matches or self._hash_file(linked_path) != source.sha256:
                diagnostics.append(
                    Diagnostic(
                        code="LINKED_SOURCE_STALE",
                        severity="fatal",
                        field=f"{role}.source",
                        message="Linked source has changed since Scene creation.",
                        hint="Re-link or re-import the changed file.",
                        capability=None,
                    )
                )
        return diagnostics

    def _scene_file(self, scene_id: str) -> Path:
        if not _SAFE_SCENE_ID.fullmatch(scene_id):
            raise ValueError("invalid scene_id")
        path = self.paths.resolve_write_path(Path("scenes") / scene_id / "scene.json")
        if not path.is_file():
            raise FileNotFoundError(f"scene not found: {scene_id}")
        return path

    def _read_linked_locator(
        self,
        scene_id: str,
        role: str,
    ) -> dict[str, str | int] | None:
        locator_path = self.paths.resolve_write_path(
            Path("scenes") / scene_id / "private-locators.json"
        )
        if not locator_path.is_file():
            return None
        try:
            locators = json.loads(locator_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        value = locators.get(role)
        if not isinstance(value, dict) or not isinstance(value.get("path"), str):
            return None
        return value

    def _safe_filename(self, filename: str) -> str:
        cleaned = re.sub(r"[^A-Za-z0-9._ -]", "_", filename).strip(" .")
        return (cleaned or "source.bin")[:180]

    def _atomic_write(self, target: Path, data: bytes) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        self.paths._assert_inside_root(target.parent)
        if target.parent.is_symlink() or target.is_symlink():
            raise ValueError("workspace write destinations cannot be symlinks")
        fd, name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
        temp_path = Path(name)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temp_path, target)
            self._fsync_directory(target.parent)
        finally:
            temp_path.unlink(missing_ok=True)

    def _fsync_directory(self, directory: Path) -> None:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        fd = os.open(directory, flags)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def _hash_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            while chunk := stream.read(_CHUNK_SIZE):
                digest.update(chunk)
        return digest.hexdigest()

    def _reject_linked_symlink_escape(self, path: Path, resolved: Path) -> None:
        expanded = path.expanduser().absolute()
        current = Path(expanded.anchor)
        for part in expanded.parts[1:]:
            current /= part
            if current.is_symlink():
                target = current.resolve(strict=True)
                if target != resolved and not resolved.is_relative_to(target):
                    raise ValueError("linked source escapes its symlink target")
