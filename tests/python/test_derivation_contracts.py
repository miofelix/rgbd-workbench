from __future__ import annotations

import pytest
from pydantic import ValidationError

from rgbd_workbench.domain.canonical import derivation_id_from_key
from rgbd_workbench.domain.contracts import (
    ArrayDescriptorV1,
    BoundsV1,
    DerivationManifestV1,
    ProcessingSpecV1,
)


def descriptor(dtype: str, shape: tuple[int, ...], offset: int, nbytes: int) -> ArrayDescriptorV1:
    return ArrayDescriptorV1(dtype=dtype, shape=shape, offset=offset, nbytes=nbytes)


def derivation_fixture(*, unit: str = "m", representation: str = "z_depth") -> DerivationManifestV1:
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
        representation=representation,
        bounds=BoundsV1(min=(-1.0, -1.0, 1.0), max=(1.0, 1.0, 2.0)),
        arrays={
            "positions": descriptor("float32", (2, 3), 128, 24),
            "colors": descriptor("uint8", (2, 3), 152, 6),
            "pixel_index": descriptor("uint32", (2,), 160, 8),
        },
    )


def test_derivation_manifest_rejects_array_that_exceeds_payload():
    with pytest.raises(ValidationError):
        descriptor("float32", (2, 3), 32, 4)


def test_derivation_manifest_rejects_unordered_bounds():
    with pytest.raises(ValidationError):
        BoundsV1(min=(1.0, -1.0, 1.0), max=(0.0, 1.0, 2.0))


def test_derivation_manifest_preserves_unitless_representation():
    manifest = derivation_fixture(unit="unitless", representation="relative_z")
    assert manifest.model_dump(mode="json")["unit"] == "unitless"


def test_derivation_manifest_rejects_metric_representation_with_unitless_label():
    with pytest.raises(ValidationError):
        derivation_fixture(unit="unitless", representation="z_depth")


def test_derivation_id_is_opaque_and_keyed_by_sha256():
    assert derivation_id_from_key("a" * 64) == "derivation-" + "a" * 64
    with pytest.raises(ValueError):
        derivation_id_from_key("../escape")


def test_processing_spec_keeps_the_point_budget_bounded():
    with pytest.raises(ValidationError):
        ProcessingSpecV1(max_points=2_000_001)
