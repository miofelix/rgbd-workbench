#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON_BIN="${RGBD_WORKBENCH_PYTHON:-.venv/bin/python}"

"$PYTHON_BIN" -m pytest -q
"$PYTHON_BIN" -m ruff check src tests scripts
"$PYTHON_BIN" -m ruff format --check src tests scripts
"$PYTHON_BIN" -m mypy src/rgbd_workbench
"$PYTHON_BIN" scripts/check-generated-schemas.py
npm test -- --run
npm run typecheck
npm run build
git diff --check
