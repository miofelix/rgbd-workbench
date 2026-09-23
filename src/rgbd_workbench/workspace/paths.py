from __future__ import annotations

from pathlib import Path


class WorkspacePaths:
    def __init__(self, root: Path) -> None:
        expanded = root.expanduser()
        if expanded == Path(expanded.anchor):
            raise ValueError("filesystem root cannot be used as a workspace")
        self.root = expanded.resolve(strict=False)
        if self.root == Path(self.root.anchor):
            raise ValueError("filesystem root cannot be used as a workspace")

    @property
    def staging(self) -> Path:
        return self.root / ".staging"

    @property
    def scenes(self) -> Path:
        return self.root / "scenes"

    @property
    def jobs(self) -> Path:
        return self.root / "jobs"

    @property
    def cache(self) -> Path:
        return self.root / "cache"

    @property
    def exports(self) -> Path:
        return self.root / "exports"

    def scene_cache(self, scene_id: str) -> Path:
        return self.scenes / scene_id / "cache"

    def initialize(self) -> None:
        for directory in (
            self.staging,
            self.scenes,
            self.jobs,
            self.cache,
            self.exports,
        ):
            self._assert_inside_root(directory)
            directory.mkdir(parents=True, exist_ok=True)
            if directory.is_symlink():
                raise ValueError("workspace write destinations cannot be symlinks")

    def resolve_write_path(self, relative_path: str | Path) -> Path:
        candidate = Path(relative_path)
        if candidate.is_absolute():
            raise ValueError("write destination must be relative to the workspace")
        resolved = (self.root / candidate).resolve(strict=False)
        self._assert_inside_root(resolved)
        current = self.root
        for part in candidate.parts:
            if part in ("", "."):
                continue
            if part == "..":
                current = current.parent
            else:
                current = current / part
            if current.is_symlink():
                target = current.resolve(strict=False)
                self._assert_inside_root(target)
        return resolved

    def _assert_inside_root(self, path: Path) -> None:
        resolved = path.resolve(strict=False)
        try:
            resolved.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("workspace write destination is outside workspace") from exc
