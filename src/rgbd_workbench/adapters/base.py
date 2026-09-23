from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np

from rgbd_workbench.domain.contracts import SourceRef
from rgbd_workbench.domain.diagnostics import Diagnostic


@dataclass(slots=True)
class ProbeCandidate:
    role: Literal["rgb", "depth", "manifest"]
    source: SourceRef
    metadata: dict[str, Any]
    diagnostics: list[Diagnostic]
    path: Path


@dataclass(slots=True)
class NormalizedDepth:
    values: np.ndarray
    valid: np.ndarray
    representation: Literal["z_depth", "relative_z"]
    unit: Literal["m", "unitless"]
    source_shape: tuple[int, int]
