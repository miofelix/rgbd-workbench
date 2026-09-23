from __future__ import annotations

import struct

import numpy as np
import pytest

from rgbd_workbench.domain.contracts import (
    ArrayDescriptorV1,
    BoundsV1,
    DerivationManifestV1,
    ProcessingSpecV1,
)
from rgbd_workbench.processing.pointcloud import PointCloudResult
from rgbd_workbench.processing.protocol import (
    decode_pointcloud,
    derivation_json,
    encode_ply,
    encode_pointcloud,
)


def result(*, unit: str = "m") -> PointCloudResult:
    return PointCloudResult(
        positions=np.ascontiguousarray(
            np.array([[-0.1, -0.1, 1.0], [0.0, -0.2, 2.0]], dtype=np.float32)
        ),
        colors=np.ascontiguousarray(np.array([[10, 20, 30], [40, 50, 60]], dtype=np.uint8)),
        pixel_index=np.ascontiguousarray(np.array([0, 1], dtype=np.uint32)),
        unit=unit,  # type: ignore[arg-type]
        representation="z_depth" if unit == "m" else "relative_z",
        source_shape=(2, 2),
        frame="camera",
        bounds=BoundsV1(min=(-0.1, -0.2, 1.0), max=(0.0, -0.1, 2.0)),
        diagnostics=(),
    )


def manifest(*, unit: str = "m") -> DerivationManifestV1:
    return DerivationManifestV1(
        schema_version=1,
        derivation_id="derivation-" + "a" * 64,
        scene_id="scene-1",
        scene_hash="b" * 64,
        derivation_key="a" * 64,
        processor_version="1",
        processing=ProcessingSpecV1(),
        point_count=2,
        source_shape=(2, 2),
        frame="camera",
        unit=unit,
        representation="z_depth" if unit == "m" else "relative_z",
        bounds=BoundsV1(min=(-0.1, -0.2, 1.0), max=(0.0, -0.1, 2.0)),
        arrays={
            "positions": ArrayDescriptorV1(dtype="float32", shape=(2, 3), offset=0, nbytes=24),
            "colors": ArrayDescriptorV1(dtype="uint8", shape=(2, 3), offset=24, nbytes=6),
            "pixel_index": ArrayDescriptorV1(dtype="uint32", shape=(2,), offset=32, nbytes=8),
        },
    )


def test_binary_round_trip_exposes_typed_arrays():
    payload = encode_pointcloud(result(), manifest())
    parsed = decode_pointcloud(payload)

    np.testing.assert_array_equal(parsed.positions, result().positions)
    np.testing.assert_array_equal(parsed.colors, result().colors)
    np.testing.assert_array_equal(parsed.pixel_index, result().pixel_index)
    assert parsed.manifest.unit == "m"


def test_binary_encoding_is_byte_stable():
    first = encode_pointcloud(result(), manifest())
    second = encode_pointcloud(result(), manifest())
    assert first == second


def test_binary_parser_rejects_truncated_array():
    payload = encode_pointcloud(result(), manifest())[:-1]
    with pytest.raises(ValueError, match="payload"):
        decode_pointcloud(payload)


def test_binary_parser_rejects_invalid_magic():
    payload = bytearray(encode_pointcloud(result(), manifest()))
    payload[:8] = b"INVALID!"
    with pytest.raises(ValueError, match="magic"):
        decode_pointcloud(bytes(payload))


def test_binary_parser_rejects_out_of_range_offset():
    payload = bytearray(encode_pointcloud(result(), manifest()))
    header_size = struct.unpack_from("<I", payload, 8)[0]
    header_start = 12
    header = payload[header_start : header_start + header_size]
    header = header.replace(b'"offset":', b'"offset":999999, "ignored":')
    # The malformed replacement is deliberately rebuilt through the public parser contract below.
    del payload[header_start : header_start + header_size]
    payload[header_start:header_start] = struct.pack("<I", len(header)) + header
    with pytest.raises(ValueError):
        decode_pointcloud(bytes(payload))


def test_ply_unitless_comment_does_not_claim_meters():
    payload = encode_ply(result(unit="unitless"), manifest(unit="unitless"))
    assert b"comment unit unitless" in payload
    assert b"meters" not in payload
    assert b"source_pixel_index" in payload


def test_derivation_json_is_utf8_and_canonical():
    payload = derivation_json(manifest())
    assert payload.startswith(b'{"arrays"')
    assert payload.endswith(b"}\n")
