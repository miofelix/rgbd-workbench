from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageFile, UnidentifiedImageError

from rgbd_workbench.adapters.base import ProbeCandidate
from rgbd_workbench.domain.contracts import SourceRef
from rgbd_workbench.domain.diagnostics import Diagnostic

MAX_PIXELS = 64 * 1024 * 1024
MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
ImageFile.LOAD_TRUNCATED_IMAGES = False


def _source(
    path: Path,
    role: str,
    *,
    width: int | None,
    height: int | None,
    dtype: str | None,
) -> SourceRef:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return SourceRef(
        role=role,  # type: ignore[arg-type]
        source_id=digest[:32],
        filename=path.name,
        sha256=digest,
        size_bytes=path.stat().st_size,
        width=width,
        height=height,
        dtype=dtype,
    )


def probe_rgb(path: Path) -> ProbeCandidate:
    diagnostics: list[Diagnostic] = []
    path = path.expanduser().resolve(strict=True)
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("RGB file exceeds configured size limit")
    try:
        with Image.open(path) as image:
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise ValueError("RGB image exceeds configured pixel limit")
            if getattr(image, "n_frames", 1) != 1:
                diagnostics.append(
                    Diagnostic(
                        code="RGB_MULTIPAGE_SELECTION_REQUIRED",
                        severity="fatal",
                        field="rgb",
                        message="RGB input contains multiple frames.",
                        hint="Select a single-page image.",
                        capability="image_inspection",
                    )
                )
            mode = image.mode
            channels = len(image.getbands())
            if "transparency" in image.info or "A" in image.getbands():
                diagnostics.append(
                    Diagnostic(
                        code="RGB_ALPHA_IGNORED",
                        severity="warning",
                        field="rgb.alpha",
                        message="RGB alpha will be ignored for geometry.",
                        hint="Use an opaque RGB source if alpha is meaningful.",
                        capability=None,
                    )
                )
            metadata = {
                "format": image.format,
                "mode": mode,
                "channels": channels,
                "width": width,
                "height": height,
                "dtype": str(np.asarray(image).dtype),
                "icc_profile": bool(image.info.get("icc_profile")),
                "exif_orientation": image.getexif().get(274),
            }
            if metadata["exif_orientation"] not in (None, 1):
                diagnostics.append(
                    Diagnostic(
                        code="RGB_ORIENTATION_CONFIRMATION_REQUIRED",
                        severity="warning",
                        field="rgb.orientation",
                        message="RGB contains a non-default EXIF orientation.",
                        hint="Confirm an identical transform for RGB and depth before geometry.",
                        capability="metric_pointcloud",
                    )
                )
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("RGB image could not be decoded") from exc
    source = _source(path, "rgb", width=width, height=height, dtype=str(np.dtype("uint8")))
    return ProbeCandidate("rgb", source, metadata, diagnostics, path)


def load_rgb(candidate: ProbeCandidate) -> np.ndarray:
    with Image.open(candidate.path) as image:
        rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    return np.ascontiguousarray(rgb)
