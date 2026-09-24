from __future__ import annotations

from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    FiniteFloat,
    StrictInt,
    StringConstraints,
    model_validator,
)

from .diagnostics import Diagnostic

Sha256 = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$", strict=True)]
VersionString = Annotated[str, StringConstraints(min_length=1, max_length=64, strict=True)]
DerivationId = Annotated[
    str,
    StringConstraints(pattern=r"^derivation-[a-f0-9]{64}$", strict=True),
]

PROCESSOR_VERSION = "1"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SourceRef(StrictModel):
    role: Literal["rgb", "depth", "manifest"]
    source_id: Annotated[str, StringConstraints(min_length=1, max_length=128, strict=True)]
    filename: Annotated[str, StringConstraints(min_length=1, max_length=255, strict=True)]
    sha256: Sha256
    size_bytes: StrictInt = Field(ge=0)
    width: StrictInt | None = Field(default=None, gt=0)
    height: StrictInt | None = Field(default=None, gt=0)
    dtype: Annotated[str, StringConstraints(min_length=1, max_length=64, strict=True)] | None = None

    @model_validator(mode="after")
    def dimensions_are_paired(self) -> SourceRef:
        if (self.width is None) != (self.height is None):
            raise ValueError("source width and height must be provided together")
        return self


class DepthSpec(StrictModel):
    representation: Literal[
        "z_depth",
        "relative_z",
        "euclidean_range",
        "inverse_depth",
        "disparity",
    ]
    unit: Literal["m", "mm", "unitless"] | None = None
    scale_to_meter: FiniteFloat | None = Field(default=None, gt=0)
    invalid_values: list[FiniteFloat] = Field(default_factory=list)
    valid_min: FiniteFloat | None = Field(default=None, gt=0)
    valid_max: FiniteFloat | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_semantics(self) -> DepthSpec:
        if self.representation == "z_depth":
            if self.unit == "unitless":
                raise ValueError("z_depth requires a metric unit")
            if self.unit is None and self.scale_to_meter is None:
                raise ValueError("z_depth requires an explicit unit or scale_to_meter")
            if self.unit is not None and self.scale_to_meter is not None:
                raise ValueError("declare either unit or scale_to_meter, not both")
        elif self.representation == "relative_z":
            if self.unit != "unitless":
                raise ValueError("relative_z must use the unitless unit")
            if self.scale_to_meter is not None:
                raise ValueError("relative_z cannot declare scale_to_meter")
        elif self.unit == "unitless" and self.scale_to_meter is not None:
            raise ValueError("unitless values cannot declare scale_to_meter")

        if self.valid_min is not None and self.valid_max is not None:
            if self.valid_min > self.valid_max:
                raise ValueError("valid_min must not exceed valid_max")
        return self


class CameraSpec(StrictModel):
    model: Literal["pinhole"]
    width: StrictInt = Field(gt=0, le=32_768)
    height: StrictInt = Field(gt=0, le=32_768)
    fx: FiniteFloat | None = Field(default=None, gt=0)
    fy: FiniteFloat | None = Field(default=None, gt=0)
    cx: FiniteFloat | None = None
    cy: FiniteFloat | None = None
    distortion_model: Literal["none", "unknown"] = "unknown"

    @model_validator(mode="after")
    def intrinsics_are_complete(self) -> CameraSpec:
        values = (self.fx, self.fy, self.cx, self.cy)
        has_any_intrinsic = any(value is not None for value in values)
        has_all_intrinsics = all(value is not None for value in values)
        if has_any_intrinsic and not has_all_intrinsics:
            raise ValueError("fx, fy, cx, and cy must be provided together")
        return self


class AlignmentSpec(StrictModel):
    state: Literal["registered_to_rgb", "unregistered", "unknown"]
    method: Annotated[str, StringConstraints(max_length=128, strict=True)] | None = None


class CapabilityReport(StrictModel):
    image_inspection: bool
    relative_pointcloud: bool
    metric_pointcloud: bool
    video_export: bool


class KNNFilterSpec(StrictModel):
    k: StrictInt = Field(default=16, ge=1, le=64)
    std_ratio: FiniteFloat = Field(default=2.0, ge=0, le=5)


class KNNSmoothSpec(StrictModel):
    k: StrictInt = Field(default=16, ge=1, le=64)


class RawDepthDescriptor(StrictModel):
    shape: list[StrictInt]
    dtype: Annotated[str, StringConstraints(min_length=1, max_length=64, strict=True)]
    endianness: Literal["little", "big", "native"]

    @model_validator(mode="after")
    def validate_shape(self) -> RawDepthDescriptor:
        if len(self.shape) != 2 or any(item <= 0 for item in self.shape):
            raise ValueError("RAW shape must contain positive dimensions")
        pixels = 1
        for dimension in self.shape:
            if pixels > 64 * 1024 * 1024 // dimension:
                raise ValueError("RAW shape exceeds configured pixel limits")
            pixels *= dimension
        return self


class SceneManifestV1(StrictModel):
    schema_version: Literal[1]
    scene_id: Annotated[str, StringConstraints(min_length=1, max_length=128, strict=True)]
    display_name: Annotated[str, StringConstraints(min_length=1, max_length=255, strict=True)]
    rgb: SourceRef
    depth: SourceRef
    depth_spec: DepthSpec | None = None
    camera: CameraSpec | None = None
    alignment: AlignmentSpec | None = None
    frame_id: Annotated[str, StringConstraints(min_length=1, max_length=128, strict=True)] = (
        "camera"
    )
    coordinate_convention: Literal["x_right_y_down_z_forward"] = "x_right_y_down_z_forward"
    normalizer_version: VersionString
    adapter_versions: dict[str, VersionString]
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    raw_descriptor: RawDepthDescriptor | None = None

    @model_validator(mode="after")
    def source_roles_are_correct(self) -> SceneManifestV1:
        if self.rgb.role != "rgb":
            raise ValueError("rgb source must have role 'rgb'")
        if self.depth.role != "depth":
            raise ValueError("depth source must have role 'depth'")
        return self


class ProcessingSpecV1(StrictModel):
    schema_version: Literal[1] = 1
    roi: tuple[StrictInt, StrictInt, StrictInt, StrictInt] | None = None
    depth_min: FiniteFloat | None = Field(default=None, gt=0)
    depth_max: FiniteFloat | None = Field(default=None, gt=0)
    xyz_min: tuple[FiniteFloat, FiniteFloat, FiniteFloat] | None = None
    xyz_max: tuple[FiniteFloat, FiniteFloat, FiniteFloat] | None = None
    pixel_stride: StrictInt = Field(default=1, ge=1)
    max_points: StrictInt = Field(default=2_000_000, ge=100, le=2_000_000)
    voxel_size: FiniteFloat | None = Field(default=None, gt=0)
    knn_filter: KNNFilterSpec | None = None
    knn_smooth: KNNSmoothSpec | None = None

    @model_validator(mode="after")
    def ranges_are_ordered(self) -> ProcessingSpecV1:
        if self.depth_min is not None and self.depth_max is not None:
            if self.depth_min > self.depth_max:
                raise ValueError("depth_min must not exceed depth_max")
        if self.xyz_min is not None and self.xyz_max is not None:
            if any(low > high for low, high in zip(self.xyz_min, self.xyz_max, strict=True)):
                raise ValueError("xyz_min must not exceed xyz_max")
        if self.roi is not None:
            x_min, y_min, x_max, y_max = self.roi
            if x_min >= x_max or y_min >= y_max:
                raise ValueError("roi must be a non-empty x/y rectangle")
        return self


ArrayDType = Literal["float32", "uint8", "uint32"]
_ARRAY_ITEMSIZE: dict[str, int] = {"float32": 4, "uint8": 1, "uint32": 4}


class ArrayDescriptorV1(StrictModel):
    dtype: ArrayDType
    shape: tuple[StrictInt, ...] = Field(min_length=1, max_length=3)
    offset: StrictInt = Field(ge=0)
    nbytes: StrictInt = Field(ge=0)

    @model_validator(mode="after")
    def payload_size_is_exact(self) -> ArrayDescriptorV1:
        if any(dimension <= 0 for dimension in self.shape):
            raise ValueError("array shape dimensions must be positive")
        elements = 1
        for dimension in self.shape:
            elements *= dimension
        expected = elements * _ARRAY_ITEMSIZE[self.dtype]
        if self.nbytes != expected:
            raise ValueError("array nbytes does not match dtype and shape")
        return self


class BoundsV1(StrictModel):
    min: tuple[FiniteFloat, FiniteFloat, FiniteFloat]
    max: tuple[FiniteFloat, FiniteFloat, FiniteFloat]

    @model_validator(mode="after")
    def axes_are_ordered(self) -> BoundsV1:
        if any(low > high for low, high in zip(self.min, self.max, strict=True)):
            raise ValueError("bounds min must not exceed max")
        return self


class DerivationManifestV1(StrictModel):
    schema_version: Literal[1]
    derivation_id: DerivationId
    scene_id: Annotated[str, StringConstraints(min_length=1, max_length=128, strict=True)]
    scene_hash: Sha256
    derivation_key: Sha256
    processor_version: VersionString
    processing: ProcessingSpecV1
    point_count: StrictInt = Field(gt=0, le=2_000_000)
    source_shape: tuple[StrictInt, StrictInt]
    frame: Annotated[str, StringConstraints(min_length=1, max_length=128, strict=True)]
    unit: Literal["m", "unitless"]
    representation: Literal["z_depth", "relative_z"]
    bounds: BoundsV1
    arrays: dict[str, ArrayDescriptorV1]
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    created_at: (
        Annotated[str, StringConstraints(min_length=1, max_length=64, strict=True)] | None
    ) = None

    @model_validator(mode="after")
    def arrays_and_semantics_are_consistent(self) -> DerivationManifestV1:
        if self.representation == "relative_z" and self.unit != "unitless":
            raise ValueError("relative_z derivations must be unitless")
        if self.representation == "z_depth" and self.unit != "m":
            raise ValueError("z_depth derivations must use meters")
        if any(dimension <= 0 for dimension in self.source_shape):
            raise ValueError("source_shape dimensions must be positive")
        expected_names = {"positions", "colors", "pixel_index"}
        if set(self.arrays) != expected_names:
            raise ValueError("arrays must contain positions, colors, and pixel_index")
        expected_shapes = {
            "positions": (self.point_count, 3),
            "colors": (self.point_count, 3),
            "pixel_index": (self.point_count,),
        }
        expected_dtypes = {
            "positions": "float32",
            "colors": "uint8",
            "pixel_index": "uint32",
        }
        for name in expected_names:
            descriptor = self.arrays[name]
            if descriptor.shape != expected_shapes[name]:
                raise ValueError(f"{name} shape does not match point_count")
            if descriptor.dtype != expected_dtypes[name]:
                raise ValueError(f"{name} dtype is invalid")
        return self


def _geometry_dimensions_match(manifest: SceneManifestV1) -> bool:
    camera = manifest.camera
    rgb = manifest.rgb
    depth = manifest.depth
    if camera is None or rgb.width is None or depth.width is None:
        return False
    return rgb.width == depth.width == camera.width and rgb.height == depth.height == camera.height


def _camera_geometry_valid(manifest: SceneManifestV1) -> bool:
    camera = manifest.camera
    return bool(
        camera is not None
        and camera.fx is not None
        and camera.fy is not None
        and camera.cx is not None
        and camera.cy is not None
        and camera.distortion_model == "none"
        and _geometry_dimensions_match(manifest)
        and manifest.alignment is not None
        and manifest.alignment.state == "registered_to_rgb"
    )


def capability_report(
    manifest: SceneManifestV1,
    diagnostics: tuple[Diagnostic, ...] | list[Diagnostic],
) -> CapabilityReport:
    all_diagnostics = [*manifest.diagnostics, *diagnostics]

    def blocked(capability: str) -> bool:
        return any(
            item.severity == "fatal"
            and not (item.code == "DEPTH_SEMANTICS_REQUIRED" and manifest.depth_spec is not None)
            and item.capability in (None, capability)
            for item in all_diagnostics
        )

    base_geometry = _camera_geometry_valid(manifest)
    depth_spec = manifest.depth_spec
    relative = bool(
        depth_spec is not None
        and base_geometry
        and depth_spec.representation == "relative_z"
        and not blocked("relative_pointcloud")
    )
    metric = bool(
        depth_spec is not None
        and base_geometry
        and depth_spec.representation == "z_depth"
        and (depth_spec.unit in ("m", "mm") or depth_spec.scale_to_meter is not None)
        and not blocked("metric_pointcloud")
    )
    image_ready = manifest.rgb.size_bytes > 0 and manifest.depth.size_bytes > 0
    return CapabilityReport(
        image_inspection=image_ready and not blocked("image_inspection"),
        relative_pointcloud=relative,
        metric_pointcloud=metric,
        video_export=(relative or metric) and not blocked("video_export"),
    )
