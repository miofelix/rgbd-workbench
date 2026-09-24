from __future__ import annotations

import math
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    FiniteFloat,
    StrictInt,
    StringConstraints,
    field_validator,
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


TrajectoryType = Literal[
    "orbit",
    "elliptical_orbit",
    "dolly",
    "pan",
    "lift",
    "orbit_tilt",
    "spiral",
    "flyover",
    "dolly_zoom",
    "custom",
]
TrajectoryTargetSource = Literal["robust_center", "roi_center", "selected_point", "manual"]
TrajectoryEasing = Literal["linear", "smoothstep", "ease_in_out_cubic"]
TrajectoryLoopMode = Literal["once", "loop"]
ProjectionMode = Literal["perspective", "orthographic"]
RenderLayout = Literal["pointcloud", "rgb_depth_pointcloud"]
RenderCodec = Literal["h264", "vp9", "png_sequence"]

Vec3 = tuple[FiniteFloat, FiniteFloat, FiniteFloat]


def _vector_length(vector: tuple[float, float, float]) -> float:
    return math.sqrt(float(vector[0]) ** 2 + float(vector[1]) ** 2 + float(vector[2]) ** 2)


def _view_is_valid(position: Vec3, target: Vec3, up: Vec3) -> bool:
    direction = (
        float(target[0] - position[0]),
        float(target[1] - position[1]),
        float(target[2] - position[2]),
    )
    up_vector = (float(up[0]), float(up[1]), float(up[2]))
    direction_length = _vector_length(direction)
    up_length = _vector_length(up_vector)
    if direction_length <= 1e-9 or up_length <= 1e-9:
        return False
    cross = (
        direction[1] * up_vector[2] - direction[2] * up_vector[1],
        direction[2] * up_vector[0] - direction[0] * up_vector[2],
        direction[0] * up_vector[1] - direction[1] * up_vector[0],
    )
    return _vector_length(cross) > direction_length * up_length * 1e-6


class CameraKeyframeV1(StrictModel):
    time: FiniteFloat = Field(ge=0)
    position: Vec3
    target: Vec3
    up: Vec3 = (0.0, -1.0, 0.0)
    projection: ProjectionMode = "perspective"
    fov: FiniteFloat = Field(default=45.0, gt=0, lt=180)
    ortho_scale: FiniteFloat = Field(default=1.0, gt=0)
    easing: TrajectoryEasing = "smoothstep"

    @model_validator(mode="after")
    def view_is_non_degenerate(self) -> CameraKeyframeV1:
        if not _view_is_valid(self.position, self.target, self.up):
            raise ValueError("camera keyframe position, target, and up are degenerate")
        return self


class CameraPathV1(StrictModel):
    schema_version: Literal[1] = 1
    frame: Annotated[str, StringConstraints(min_length=1, max_length=128, strict=True)] = "camera"
    unit: Literal["m", "unitless"]
    trajectory_type: TrajectoryType
    target_source: TrajectoryTargetSource = "manual"
    target: Vec3
    duration: FiniteFloat = Field(gt=0, le=3600)
    fps: StrictInt = Field(default=30, ge=1, le=240)
    easing: TrajectoryEasing = "smoothstep"
    loop_mode: TrajectoryLoopMode = "once"
    projection: ProjectionMode = "perspective"
    fov: FiniteFloat = Field(default=45.0, gt=0, lt=180)
    ortho_scale: FiniteFloat = Field(default=1.0, gt=0)
    parameters: dict[
        Annotated[str, StringConstraints(min_length=1, max_length=64, strict=True)], FiniteFloat
    ] = Field(default_factory=dict)
    keyframes: list[CameraKeyframeV1] = Field(default_factory=list, max_length=1024)
    sampler_version: VersionString = "1"

    @model_validator(mode="after")
    def validate_timeline(self) -> CameraPathV1:
        if self.trajectory_type == "custom" and len(self.keyframes) < 2:
            raise ValueError("custom camera paths require at least two keyframes")
        if self.trajectory_type != "custom" and self.keyframes:
            raise ValueError("preset camera paths cannot contain custom keyframes")
        if self.keyframes:
            times = [float(keyframe.time) for keyframe in self.keyframes]
            if times[0] != 0.0 or times[-1] != float(self.duration):
                raise ValueError("keyframe times must start at zero and end at duration")
            if any(left >= right for left, right in zip(times, times[1:])):
                raise ValueError("keyframe times must be strictly increasing")
            if any(
                keyframe.projection != self.keyframes[0].projection for keyframe in self.keyframes
            ):
                raise ValueError("custom keyframes must use one projection mode")
            if self.loop_mode == "loop":
                first, last = self.keyframes[0], self.keyframes[-1]
                tolerance = 1e-6
                for left, right in (
                    (first.position, last.position),
                    (first.target, last.target),
                    (first.up, last.up),
                ):
                    if any(abs(a - b) > tolerance for a, b in zip(left, right, strict=True)):
                        raise ValueError("loop keyframes must have matching endpoints")
                if first.fov != last.fov or first.ortho_scale != last.ortho_scale:
                    raise ValueError("loop keyframes must have matching projection parameters")
        if self.target_source == "manual" and self.target is None:
            raise ValueError("manual camera paths require a resolved target")
        return self


class RenderSpecV1(StrictModel):
    schema_version: Literal[1] = 1
    layout: RenderLayout = "pointcloud"
    width: StrictInt = Field(default=1280, gt=0, le=3840)
    height: StrictInt = Field(default=720, gt=0, le=2160)
    fps: StrictInt = Field(default=30, ge=1, le=240)
    duration: FiniteFloat = Field(default=5.0, gt=0, le=3600)
    codec: RenderCodec = "h264"
    quality: StrictInt = Field(default=80, ge=0, le=100)
    point_budget: StrictInt = Field(default=150_000, ge=100, le=2_000_000)
    point_size: FiniteFloat = Field(default=2.0, gt=0, le=64)
    antialias: Literal[1, 2] = 1
    background: tuple[StrictInt, StrictInt, StrictInt] = (18, 37, 50)
    depth_colormap: Annotated[str, StringConstraints(min_length=1, max_length=32, strict=True)] = (
        "viridis"
    )
    depth_range: tuple[FiniteFloat, FiniteFloat] | None = None
    show_axes: bool = False
    show_grid: bool = False
    show_title: bool = False
    show_time: bool = False
    show_provenance: bool = False
    scene_revision: (
        Annotated[str, StringConstraints(min_length=1, max_length=128, strict=True)] | None
    ) = None
    derivation_id: DerivationId | None = None
    view_spec: dict[str, Any] = Field(default_factory=dict)
    camera_path: CameraPathV1 | None = None

    @field_validator("background")
    @classmethod
    def background_is_rgb(cls, value: tuple[int, int, int]) -> tuple[int, int, int]:
        if any(channel < 0 or channel > 255 for channel in value):
            raise ValueError("background channels must be in the range 0..255")
        return value

    @model_validator(mode="after")
    def validate_render_ranges(self) -> RenderSpecV1:
        if self.depth_range is not None and self.depth_range[0] > self.depth_range[1]:
            raise ValueError("depth_range minimum must not exceed maximum")
        if self.codec == "h264" and (self.width % 2 or self.height % 2):
            raise ValueError("h264 render dimensions must be even")
        if self.camera_path is not None:
            if self.camera_path.fps != self.fps:
                raise ValueError("camera path and render fps must match")
            if self.camera_path.duration != self.duration:
                raise ValueError("camera path and render duration must match")
        return self


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

    @field_validator("roi")
    @classmethod
    def roi_is_non_empty(
        cls, value: tuple[int, int, int, int] | None
    ) -> tuple[int, int, int, int] | None:
        if value is not None:
            x_min, y_min, x_max, y_max = value
            if x_min >= x_max or y_min >= y_max:
                raise ValueError("roi must be a non-empty x/y rectangle")
        return value

    @model_validator(mode="after")
    def ranges_are_ordered(self) -> ProcessingSpecV1:
        if self.depth_min is not None and self.depth_max is not None:
            if self.depth_min > self.depth_max:
                raise ValueError("depth_min must not exceed depth_max")
        if self.xyz_min is not None and self.xyz_max is not None:
            if any(low > high for low, high in zip(self.xyz_min, self.xyz_max, strict=True)):
                raise ValueError("xyz_min must not exceed xyz_max")
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
