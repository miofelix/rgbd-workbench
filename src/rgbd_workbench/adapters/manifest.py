from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from rgbd_workbench.adapters.base import ProbeCandidate
from rgbd_workbench.adapters.image import MAX_FILE_BYTES, _source
from rgbd_workbench.domain.diagnostics import Diagnostic

DEFAULT_MAX_BYTES = 1024 * 1024
MAX_NODES = 100_000
MAX_DEPTH = 64


def _validate_structure(value: Any, *, depth: int = 0, nodes: list[int] | None = None) -> None:
    if nodes is None:
        nodes = [0]
    nodes[0] += 1
    if nodes[0] > MAX_NODES:
        raise ValueError("manifest node limit exceeded")
    if depth > MAX_DEPTH:
        raise ValueError("manifest depth limit exceeded")
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                raise ValueError("manifest keys must be strings")
            _validate_structure(child, depth=depth + 1, nodes=nodes)
    elif isinstance(value, list):
        for child in value:
            _validate_structure(child, depth=depth + 1, nodes=nodes)


def load_manifest_document(path: Path, *, max_bytes: int = DEFAULT_MAX_BYTES) -> dict[str, Any]:
    path = path.expanduser().resolve(strict=True)
    if path.stat().st_size > max_bytes:
        raise ValueError("manifest exceeds configured size limit")
    raw = path.read_bytes()
    try:
        if path.suffix.lower() == ".json":
            value = json.loads(raw.decode("utf-8"))
        elif path.suffix.lower() in {".yaml", ".yml"}:
            value = yaml.safe_load(raw.decode("utf-8"))
        else:
            raise ValueError("manifest format is unsupported")
    except yaml.YAMLError as exc:
        raise ValueError("manifest YAML must use safe constructs") from exc
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, MemoryError) as exc:
        raise ValueError("manifest document is invalid") from exc
    if isinstance(value, dict) and value.get("schema_version") not in (None, 1):
        raise ValueError("unsupported manifest schema version")
    _validate_structure(value)
    if not isinstance(value, dict):
        raise ValueError("manifest root must be an object")
    depth = value.get("depth") if isinstance(value.get("depth"), dict) else value
    shape = depth.get("shape") if isinstance(depth, dict) else None
    if shape is not None and (
        not isinstance(shape, (list, tuple))
        or len(shape) != 2
        or any(not isinstance(item, int) or item <= 0 for item in shape)
    ):
        raise ValueError("manifest depth shape must contain two positive integers")
    return value


def probe_manifest(path: Path) -> ProbeCandidate:
    path = path.expanduser().resolve(strict=True)
    diagnostics: list[Diagnostic] = []
    if path.stat().st_size > min(DEFAULT_MAX_BYTES, MAX_FILE_BYTES):
        diagnostics.append(
            Diagnostic(
                code="MANIFEST_SIZE_LIMIT",
                severity="fatal",
                field="manifest",
                message="Manifest exceeds the configured size limit.",
                hint="Use a compact JSON/YAML manifest.",
                capability="image_inspection",
            )
        )
        document: dict[str, Any] = {}
    else:
        try:
            document = load_manifest_document(path)
        except ValueError as exc:
            diagnostics.append(
                Diagnostic(
                    code="MANIFEST_INVALID",
                    severity="fatal",
                    field="manifest",
                    message=str(exc),
                    hint="Provide a valid JSON or safe YAML object.",
                    capability="image_inspection",
                )
            )
            document = {}
    required = {"schema_version", "depth", "camera", "alignment"}
    if not required.issubset(document):
        diagnostics.append(
            Diagnostic(
                code="MANIFEST_SCHEMA_INCOMPLETE",
                severity="warning",
                field="manifest",
                message="Manifest does not contain all optional geometry declarations.",
                hint="Use the import wizard to provide missing semantics.",
                capability="metric_pointcloud",
            )
        )
    source = _source(path, "manifest", width=None, height=None, dtype="json-or-yaml")
    return ProbeCandidate("manifest", source, document, diagnostics, path)
