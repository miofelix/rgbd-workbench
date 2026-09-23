from __future__ import annotations

from pathlib import Path
from typing import Literal

import numpy as np

from rgbd_workbench.adapters.base import NormalizedDepth, ProbeCandidate
from rgbd_workbench.adapters.depth import load_depth, probe_depth
from rgbd_workbench.adapters.image import load_rgb, probe_rgb
from rgbd_workbench.adapters.manifest import probe_manifest
from rgbd_workbench.domain.contracts import SceneManifestV1


class AdapterRegistry:
    @classmethod
    def default(cls) -> AdapterRegistry:
        return cls()

    def probe(self, path: Path, role: Literal["rgb", "depth", "manifest"] | str) -> ProbeCandidate:
        if role == "rgb":
            return probe_rgb(path)
        if role == "depth":
            return probe_depth(path)
        if role == "manifest":
            return probe_manifest(path)
        raise ValueError(f"unsupported source role: {role}")

    def normalize(
        self,
        depth_candidate: ProbeCandidate,
        manifest: SceneManifestV1,
    ) -> NormalizedDepth:
        if depth_candidate.role != "depth":
            raise ValueError("normalization requires a depth candidate")
        if manifest.depth_spec is None:
            raise ValueError("depth semantics are required before normalization")
        values = load_depth(depth_candidate)
        expected_shape = (manifest.depth.height, manifest.depth.width)
        if None in expected_shape or values.shape != expected_shape:
            raise ValueError(
                f"depth shape {values.shape} does not match manifest shape {expected_shape}"
            )
        if not np.issubdtype(values.dtype, np.number):
            raise ValueError("depth array must contain numeric values")
        raw = np.asarray(values)
        valid = np.isfinite(raw) & (raw > 0)
        for invalid in manifest.depth_spec.invalid_values:
            valid &= raw != invalid
        representation = manifest.depth_spec.representation
        if representation == "relative_z":
            normalized = raw.astype(np.float32, copy=True)
            unit: Literal["m", "unitless"] = "unitless"
        elif representation == "z_depth":
            if manifest.depth_spec.scale_to_meter is not None:
                scale = manifest.depth_spec.scale_to_meter
            elif manifest.depth_spec.unit == "mm":
                scale = 0.001
            elif manifest.depth_spec.unit == "m":
                scale = 1.0
            else:
                raise ValueError("metric depth semantics require m, mm, or scale_to_meter")
            normalized = raw.astype(np.float32, copy=True) * np.float32(scale)
            unit = "m"
        else:
            raise ValueError("depth representation is not supported by the M1 normalizer")
        valid &= np.isfinite(normalized) & (normalized > 0)
        if manifest.depth_spec.valid_min is not None:
            minimum = (
                manifest.depth_spec.valid_min
                if unit == "unitless"
                else float(manifest.depth_spec.valid_min)
            )
            valid &= normalized >= minimum
        if manifest.depth_spec.valid_max is not None:
            maximum = (
                manifest.depth_spec.valid_max
                if unit == "unitless"
                else float(manifest.depth_spec.valid_max)
            )
            valid &= normalized <= maximum
        normalized[~valid] = np.float32(0)
        return NormalizedDepth(
            values=np.ascontiguousarray(normalized, dtype=np.float32),
            valid=np.ascontiguousarray(valid, dtype=bool),
            representation=representation,
            unit=unit,
            source_shape=(int(raw.shape[0]), int(raw.shape[1])),
        )

    def load_rgb(self, candidate: ProbeCandidate) -> np.ndarray:
        if candidate.role != "rgb":
            raise ValueError("RGB loader requires an RGB candidate")
        return load_rgb(candidate)

    def load_depth(self, candidate: ProbeCandidate) -> np.ndarray:
        if candidate.role != "depth":
            raise ValueError("depth loader requires a depth candidate")
        return load_depth(candidate)
