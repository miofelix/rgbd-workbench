#!/usr/bin/env python3
"""Generate or check the tracked JSON Schemas for public domain models."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from rgbd_workbench.domain.contracts import DerivationManifestV1, SceneManifestV1
from rgbd_workbench.domain.diagnostics import Diagnostic

SCHEMAS: dict[str, Any] = {
    "scene-manifest-v1.json": SceneManifestV1.model_json_schema(),
    "diagnostic-v1.json": Diagnostic.model_json_schema(),
    "derivation-manifest-v1.json": DerivationManifestV1.model_json_schema(),
}


def schema_bytes(schema: Any) -> bytes:
    return (json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    schema_dir = root / "schemas"
    if args.write:
        schema_dir.mkdir(exist_ok=True)
    errors: list[str] = []
    for name, schema in SCHEMAS.items():
        path = schema_dir / name
        expected = schema_bytes(schema)
        if args.write:
            path.write_bytes(expected)
        elif not path.is_file() or path.read_bytes() != expected:
            errors.append(name)
    if errors:
        parser.error("generated schemas are out of date: " + ", ".join(errors))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
