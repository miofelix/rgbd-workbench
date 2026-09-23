from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, UnidentifiedImageError

from rgbd_workbench.adapters.base import ProbeCandidate
from rgbd_workbench.adapters.image import MAX_FILE_BYTES, MAX_PIXELS, _source
from rgbd_workbench.domain.diagnostics import Diagnostic

MAX_ARRAY_BYTES = 256 * 1024 * 1024


def _validate_npy_stream(stream: Any) -> None:
    version = np.lib.format.read_magic(stream)
    if version == (1, 0):
        shape, _, dtype = np.lib.format.read_array_header_1_0(stream)
    elif version == (2, 0):
        shape, _, dtype = np.lib.format.read_array_header_2_0(stream)
    elif version == (3, 0):
        shape, _, dtype = np.lib.format.read_array_header_2_0(stream)
    else:
        raise ValueError("DEPTH_DECODE_FAILED: unsupported NPY version")
    if dtype.hasobject:
        raise ValueError("DEPTH_OBJECT_DTYPE: NPY object dtype is not allowed")
    if len(shape) != 2 or any(int(dimension) <= 0 for dimension in shape):
        raise ValueError("DEPTH_SIZE_LIMIT: NPY shape must be a positive two-dimensional shape")
    elements = 1
    for dimension in shape:
        dimension_value = int(dimension)
        if elements > MAX_PIXELS // dimension_value:
            raise ValueError("DEPTH_SIZE_LIMIT: NPY declared array exceeds configured limits")
        elements *= dimension_value
    if elements * dtype.itemsize > MAX_ARRAY_BYTES:
        raise ValueError("DEPTH_SIZE_LIMIT: NPY declared array exceeds configured limits")


def _validate_npz_members(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        names = [name for name in archive.namelist() if name.endswith(".npy")]
        if not names:
            raise ValueError("DEPTH_DECODE_FAILED: NPZ has no NPY members")
        for info in archive.infolist():
            if info.file_size > MAX_ARRAY_BYTES:
                raise ValueError("DEPTH_SIZE_LIMIT: NPZ member exceeds configured limits")
        if len(names) == 1:
            with archive.open(names[0]) as member:
                _validate_npy_stream(member)
        return names


def _fatal(
    code: str,
    message: str,
    hint: str,
    capability: str = "relative_pointcloud",
) -> Diagnostic:
    return Diagnostic(
        code=code,
        severity="fatal",
        field="depth",
        message=message,
        hint=hint,
        capability=capability,
    )


def _array_metadata(array: np.ndarray) -> dict[str, Any]:
    if array.ndim != 2:
        raise ValueError("depth array must be two-dimensional")
    height, width = array.shape
    if height * width > MAX_PIXELS:
        raise ValueError("depth array exceeds configured pixel limit")
    return {
        "shape": [height, width],
        "height": height,
        "width": width,
        "dtype": str(array.dtype),
        "unit": None,
    }


def _load_pfm(path: Path) -> np.ndarray:
    with path.open("rb") as stream:
        magic = stream.readline().strip()
        if magic not in {b"Pf", b"PF"}:
            raise ValueError("PFM magic is invalid")
        dimensions = stream.readline().strip()
        match = re.fullmatch(rb"(\d+)\s+(\d+)", dimensions)
        if match is None:
            raise ValueError("PFM dimensions are invalid")
        width, height = map(int, match.groups())
        scale = float(stream.readline().strip())
        if not np.isfinite(scale) or scale == 0:
            raise ValueError("PFM scale is invalid")
        channels = 3 if magic == b"PF" else 1
        count = width * height * channels
        if count > MAX_PIXELS * channels:
            raise ValueError("PFM exceeds configured pixel limit")
        payload = stream.read()
        expected = count * 4
        if len(payload) != expected:
            raise ValueError("PFM payload length does not match dimensions")
        dtype = np.dtype("<f4" if scale < 0 else ">f4")
        values = np.frombuffer(payload, dtype=dtype).reshape((height, width, channels))
        values = np.flipud(values)
        if channels == 1:
            values = values[:, :, 0]
        else:
            raise ValueError("color PFM is not a depth array")
        return np.ascontiguousarray(values * abs(scale), dtype=np.float32)


def _load_array(path: Path, metadata: dict[str, Any]) -> np.ndarray:
    suffix = path.suffix.lower()
    if suffix == ".pfm":
        return _load_pfm(path)
    if suffix == ".npy":
        with path.open("rb") as stream:
            _validate_npy_stream(stream)
        try:
            value = np.load(path, allow_pickle=False, mmap_mode="r")
        except (ValueError, OSError) as exc:
            raise ValueError("NPY depth array is invalid or uses object dtype") from exc
        if value.dtype.hasobject:
            raise ValueError("NPY object dtype is not allowed")
        return np.asarray(value)
    if suffix == ".npz":
        names = _validate_npz_members(path)
        try:
            archive = np.load(path, allow_pickle=False)
            if len(names) != 1:
                raise ValueError("NPZ contains multiple arrays")
            value = archive[names[0]]
        except (ValueError, OSError, AttributeError) as exc:
            raise ValueError("NPZ depth archive is invalid") from exc
        if value.dtype.hasobject:
            raise ValueError("NPZ object dtype is not allowed")
        return np.asarray(value)
    if suffix in {".png", ".tif", ".tiff"}:
        try:
            with Image.open(path) as image:
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError("depth image contains multiple frames")
                value = np.asarray(image)
        except (UnidentifiedImageError, OSError) as exc:
            raise ValueError("depth image could not be decoded") from exc
        return value
    if suffix in {".raw", ".bin"}:
        descriptor = metadata.get("raw_descriptor")
        if not isinstance(descriptor, dict):
            raise ValueError("RAW descriptor is required")
        dtype = np.dtype(str(descriptor["dtype"]))
        shape = tuple(int(item) for item in descriptor["shape"])
        if len(shape) != 2:
            raise ValueError("RAW shape must be two-dimensional")
        expected = int(np.prod(shape)) * dtype.itemsize
        if expected != path.stat().st_size:
            raise ValueError("RAW payload length does not match descriptor")
        return np.fromfile(path, dtype=dtype).reshape(shape)
    raise ValueError("unsupported depth format")


def probe_depth(path: Path) -> ProbeCandidate:
    path = path.expanduser().resolve(strict=True)
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("depth file exceeds configured size limit")
    diagnostics: list[Diagnostic] = []
    metadata: dict[str, Any] = {"format": path.suffix.lower().lstrip(".")}
    try:
        if path.suffix.lower() == ".raw" or path.suffix.lower() == ".bin":
            metadata.update({"shape": None, "dtype": None, "unit": None})
            diagnostics.append(
                _fatal(
                    "RAW_DESCRIPTOR_REQUIRED",
                    "RAW/BIN depth requires an explicit shape, dtype, and endianness descriptor.",
                    "Provide these fields in the manifest.",
                )
            )
            source = _source(path, "depth", width=None, height=None, dtype=None)
            return ProbeCandidate("depth", source, metadata, diagnostics, path)
        value = _load_array(path, metadata)
        if value.dtype.hasobject:
            diagnostics.append(
                _fatal(
                    "DEPTH_OBJECT_DTYPE",
                    "Object depth arrays are not allowed.",
                    "Save a numeric array.",
                )
            )
        metadata.update(_array_metadata(value))
        if path.suffix.lower() == ".npz":
            with np.load(path, allow_pickle=False) as archive:
                if len(archive.files) != 1:
                    diagnostics.append(
                        _fatal(
                            "DEPTH_ARRAY_SELECTION_REQUIRED",
                            "NPZ contains more than one array.",
                            "Choose one named array in the manifest.",
                        )
                    )
        diagnostics.append(
            _fatal(
                "DEPTH_SEMANTICS_REQUIRED",
                "Depth representation and unit are not inferred from the file.",
                "Declare z_depth/relative_z and its unit in the manifest.",
            )
        )
        source = _source(
            path,
            "depth",
            width=int(metadata["width"]),
            height=int(metadata["height"]),
            dtype=str(metadata["dtype"]),
        )
        return ProbeCandidate("depth", source, metadata, diagnostics, path)
    except ValueError as exc:
        code = "DEPTH_DECODE_FAILED"
        if "DEPTH_SIZE_LIMIT" in str(exc):
            code = "DEPTH_SIZE_LIMIT"
        elif "object dtype" in str(exc) or "DEPTH_OBJECT_DTYPE" in str(exc):
            code = "DEPTH_OBJECT_DTYPE"
        elif path.suffix.lower() == ".npz":
            try:
                with np.load(path, allow_pickle=False) as archive:
                    if len(archive.files) != 1:
                        code = "DEPTH_ARRAY_SELECTION_REQUIRED"
            except (OSError, ValueError):
                pass
        diagnostics.append(
            _fatal(code, str(exc), "Provide a valid numeric two-dimensional depth array.")
        )
        source = _source(path, "depth", width=None, height=None, dtype=None)
        return ProbeCandidate("depth", source, metadata, diagnostics, path)


def load_depth(candidate: ProbeCandidate) -> np.ndarray:
    return np.ascontiguousarray(_load_array(candidate.path, candidate.metadata))
