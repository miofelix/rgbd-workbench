#!/usr/bin/env python3
"""Check generated JSON schemas once the domain models are available."""

from __future__ import annotations

import argparse
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    (root / "schemas").mkdir(exist_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
