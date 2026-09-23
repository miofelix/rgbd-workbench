from __future__ import annotations

import json
import struct
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np
from pydantic import BaseModel

from rgbd_workbench.domain.canonical import canonical_json_bytes
from rgbd_workbench.domain.contracts import (
    ArrayDescriptorV1,
    ArrayDType,
    DerivationManifestV1,
)

MAGIC = b"RGBDPC1\x00"
_PREFIX_SIZE = len(MAGIC) + 4
_DTYPES: dict[str, np.dtype[Any]] = {
    "float32": np.dtype("<f4"),
    "uint8": np.dtype("u1"),
    "uint32": np.dtype("<u4"),
}


@dataclass(frozen=True, slots=True)
class ParsedPointCloud:
    manifest: DerivationManifestV1
    positions: np.ndarray
    colors: np.ndarray
    pixel_index: np.ndarray


def _align4(value: int) -> int:
    return (value + 3) & ~3


def _base_payload(base: DerivationManifestV1 | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(base, BaseModel):
        return base.model_dump(mode="python", exclude_none=False)
    return dict(base)


def _descriptors(result: Any, payload_start: int) -> dict[str, ArrayDescriptorV1]:
    arrays: tuple[tuple[str, np.ndarray, ArrayDType], ...] = (
        ("positions", np.ascontiguousarray(result.positions, dtype=np.float32), "float32"),
        ("colors", np.ascontiguousarray(result.colors, dtype=np.uint8), "uint8"),
        ("pixel_index", np.ascontiguousarray(result.pixel_index, dtype=np.uint32), "uint32"),
    )
    descriptors: dict[str, ArrayDescriptorV1] = {}
    offset = payload_start
    for name, array, dtype in arrays:
        offset = _align4(offset)
        data_size = int(array.nbytes)
        descriptors[name] = ArrayDescriptorV1(
            dtype=dtype,
            shape=tuple(int(dimension) for dimension in array.shape),
            offset=offset,
            nbytes=data_size,
        )
        offset += data_size
    return descriptors


def _manifest_for_result(
    result: Any,
    base: DerivationManifestV1 | Mapping[str, Any],
    descriptors: dict[str, ArrayDescriptorV1],
) -> DerivationManifestV1:
    payload = _base_payload(base)
    payload.update(
        {
            "point_count": result.point_count,
            "source_shape": result.source_shape,
            "frame": result.frame,
            "unit": result.unit,
            "representation": result.representation,
            "bounds": result.bounds.model_dump(mode="python"),
            "arrays": {
                name: descriptor.model_dump(mode="python")
                for name, descriptor in descriptors.items()
            },
            "diagnostics": [item.model_dump(mode="python") for item in result.diagnostics],
        }
    )
    return DerivationManifestV1.model_validate(payload)


def manifest_for_result(
    result: Any,
    base: DerivationManifestV1 | Mapping[str, Any],
) -> DerivationManifestV1:
    """Build a validated derivation manifest with final binary offsets."""
    payload_start = 0
    manifest: DerivationManifestV1 | None = None
    for _ in range(12):
        descriptors = _descriptors(result, payload_start)
        manifest = _manifest_for_result(result, base, descriptors)
        header_length = len(canonical_json_bytes(manifest))
        next_payload_start = _align4(_PREFIX_SIZE + header_length)
        if next_payload_start == payload_start:
            return manifest
        payload_start = next_payload_start
    raise ValueError("point-cloud header length did not converge")


def _arrays_bytes(result: Any) -> tuple[bytes, bytes, bytes]:
    return (
        np.ascontiguousarray(result.positions, dtype=np.float32).tobytes(order="C"),
        np.ascontiguousarray(result.colors, dtype=np.uint8).tobytes(order="C"),
        np.ascontiguousarray(result.pixel_index, dtype=np.uint32).tobytes(order="C"),
    )


def _normalize_wire_tuples(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    normalized = dict(payload)
    if isinstance(normalized.get("source_shape"), list):
        normalized["source_shape"] = tuple(normalized["source_shape"])
    bounds = normalized.get("bounds")
    if isinstance(bounds, dict):
        normalized["bounds"] = {
            **bounds,
            "min": (
                tuple(bounds["min"]) if isinstance(bounds.get("min"), list) else bounds.get("min")
            ),
            "max": (
                tuple(bounds["max"]) if isinstance(bounds.get("max"), list) else bounds.get("max")
            ),
        }
    arrays = normalized.get("arrays")
    if isinstance(arrays, dict):
        normalized["arrays"] = {
            name: {
                **descriptor,
                "shape": tuple(descriptor["shape"])
                if isinstance(descriptor, dict) and isinstance(descriptor.get("shape"), list)
                else descriptor.get("shape"),
            }
            if isinstance(descriptor, dict)
            else descriptor
            for name, descriptor in arrays.items()
        }
    processing = normalized.get("processing")
    if isinstance(processing, dict):
        normalized["processing"] = {
            **processing,
            **{
                name: tuple(processing[name])
                for name in ("roi", "xyz_min", "xyz_max")
                if isinstance(processing.get(name), list)
            },
        }
    return normalized


def encode_pointcloud(
    result: Any,
    manifest_base: DerivationManifestV1 | Mapping[str, Any],
) -> bytes:
    manifest = manifest_for_result(result, manifest_base)
    header = canonical_json_bytes(manifest)
    payload_start = _align4(_PREFIX_SIZE + len(header))
    if payload_start != manifest.arrays["positions"].offset:
        raise ValueError("point-cloud manifest offsets are inconsistent")
    position_bytes, color_bytes, pixel_bytes = _arrays_bytes(result)
    output = bytearray()
    output.extend(MAGIC)
    output.extend(struct.pack("<I", len(header)))
    output.extend(header)
    output.extend(b"\x00" * (payload_start - len(output)))
    for descriptor, data in zip(
        (
            manifest.arrays["positions"],
            manifest.arrays["colors"],
            manifest.arrays["pixel_index"],
        ),
        (position_bytes, color_bytes, pixel_bytes),
        strict=True,
    ):
        output.extend(b"\x00" * (descriptor.offset - len(output)))
        output.extend(data)
    if len(output) != max(
        descriptor.offset + descriptor.nbytes for descriptor in manifest.arrays.values()
    ):
        raise ValueError("point-cloud payload size does not match manifest")
    return bytes(output)


def decode_pointcloud(payload: bytes | bytearray | memoryview) -> ParsedPointCloud:
    raw = bytes(payload)
    if len(raw) < _PREFIX_SIZE or raw[: len(MAGIC)] != MAGIC:
        raise ValueError("point-cloud magic is invalid")
    header_length = struct.unpack_from("<I", raw, len(MAGIC))[0]
    header_start = _PREFIX_SIZE
    header_end = header_start + header_length
    if header_end > len(raw):
        raise ValueError("point-cloud header exceeds payload")
    try:
        header_payload = json.loads(raw[header_start:header_end].decode("utf-8"))
        manifest = DerivationManifestV1.model_validate(_normalize_wire_tuples(header_payload))
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise ValueError("point-cloud header is invalid") from exc
    payload_start = _align4(header_end)
    ranges: list[tuple[int, int, str]] = []
    for name, descriptor in manifest.arrays.items():
        if (
            descriptor.offset < payload_start
            or descriptor.offset % 4 != 0
            or descriptor.offset + descriptor.nbytes > len(raw)
        ):
            raise ValueError(f"point-cloud {name} payload range is invalid")
        ranges.append((descriptor.offset, descriptor.offset + descriptor.nbytes, name))
    ranges.sort()
    for previous, current in zip(ranges, ranges[1:]):
        if current[0] < previous[1]:
            raise ValueError("point-cloud payload ranges overlap")
    if not ranges or ranges[-1][1] != len(raw):
        raise ValueError("point-cloud payload size does not match header")
    arrays: dict[str, np.ndarray] = {}
    for name, descriptor in manifest.arrays.items():
        dtype = _DTYPES[descriptor.dtype]
        expected = int(np.prod(descriptor.shape, dtype=np.int64)) * dtype.itemsize
        if expected != descriptor.nbytes:
            raise ValueError(f"point-cloud {name} payload size is invalid")
        arrays[name] = np.frombuffer(
            raw,
            dtype=dtype,
            count=int(np.prod(descriptor.shape, dtype=np.int64)),
            offset=descriptor.offset,
        ).reshape(descriptor.shape)
    return ParsedPointCloud(
        manifest=manifest,
        positions=arrays["positions"],
        colors=arrays["colors"],
        pixel_index=arrays["pixel_index"],
    )


def encode_ply(result: Any, manifest: DerivationManifestV1) -> bytes:
    count = result.point_count
    header = "\n".join(
        [
            "ply",
            "format binary_little_endian 1.0",
            f"comment frame {manifest.frame}",
            f"comment unit {manifest.unit}",
            f"comment representation {manifest.representation}",
            f"comment scene_hash {manifest.scene_hash}",
            f"comment derivation_key {manifest.derivation_key}",
            f"element vertex {count}",
            "property float x",
            "property float y",
            "property float z",
            "property uchar red",
            "property uchar green",
            "property uchar blue",
            "property uint source_pixel_index",
            "end_header",
            "",
        ]
    ).encode("ascii")
    record_dtype = np.dtype(
        [
            ("x", "<f4"),
            ("y", "<f4"),
            ("z", "<f4"),
            ("red", "u1"),
            ("green", "u1"),
            ("blue", "u1"),
            ("source_pixel_index", "<u4"),
        ],
        align=False,
    )
    records = np.empty(count, dtype=record_dtype)
    records["x"], records["y"], records["z"] = result.positions.T
    records["red"], records["green"], records["blue"] = result.colors.T
    records["source_pixel_index"] = result.pixel_index
    return header + records.tobytes(order="C")


def derivation_json(manifest: DerivationManifestV1) -> bytes:
    return canonical_json_bytes(manifest) + b"\n"
