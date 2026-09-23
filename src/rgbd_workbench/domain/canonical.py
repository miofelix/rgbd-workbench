from __future__ import annotations

import hashlib
from collections.abc import Mapping
from typing import Any

import rfc8785
from pydantic import BaseModel

from .contracts import ProcessingSpecV1, SceneManifestV1


def _jsonable(value: BaseModel | Mapping[str, Any]) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", exclude_none=False)
    return dict(value)


def canonical_json_bytes(value: BaseModel | Mapping[str, Any]) -> bytes:
    try:
        return rfc8785.dumps(_jsonable(value))
    except (ValueError, TypeError, OverflowError) as exc:
        message = str(exc)
        if "nan" in message.lower() or "infinity" in message.lower():
            raise ValueError("non-finite number cannot be canonicalized") from exc
        raise ValueError(f"value cannot be canonicalized: {message}") from exc


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def scene_hash(
    source_hashes: Mapping[str, str],
    manifest: SceneManifestV1,
    normalizer_version: str,
) -> str:
    payload = {
        "schema_version": 1,
        "source_hashes": dict(source_hashes),
        "manifest": manifest.model_dump(mode="json", exclude_none=False),
        "normalizer_version": normalizer_version,
    }
    return sha256_bytes(canonical_json_bytes(payload))


def derivation_key(
    scene_hash_value: str,
    processing: ProcessingSpecV1,
    processor_version: str,
) -> str:
    payload = {
        "schema_version": 1,
        "scene_hash": scene_hash_value,
        "processing": processing.model_dump(mode="json", exclude_none=False),
        "processor_version": processor_version,
    }
    return sha256_bytes(canonical_json_bytes(payload))
