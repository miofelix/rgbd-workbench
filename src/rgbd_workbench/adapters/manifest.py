from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from rgbd_workbench.adapters.base import ProbeCandidate
from rgbd_workbench.adapters.image import MAX_FILE_BYTES, _source
from rgbd_workbench.domain.diagnostics import Diagnostic

DEFAULT_MAX_BYTES = 1024 * 1024


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
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("manifest document is invalid") from exc
    if not isinstance(value, dict):
        raise ValueError("manifest root must be an object")
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
