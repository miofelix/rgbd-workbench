from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from rgbd_workbench.domain.contracts import AlignmentSpec, CameraSpec
from rgbd_workbench.domain.diagnostics import Diagnostic


class MetadataUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    display_name: str | None = Field(default=None, min_length=1, max_length=255)
    representation: str | None = None
    unit: str | None = None
    scale_to_meter: float | None = Field(default=None, gt=0)
    invalid_values: list[float] = Field(default_factory=list)
    valid_min: float | None = Field(default=None, gt=0)
    valid_max: float | None = Field(default=None, gt=0)
    camera: CameraSpec | None = None
    alignment: AlignmentSpec | None = None


class DiagnosticResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    severity: str
    field: str | None
    message: str
    hint: str | None
    capability: str | None

    @classmethod
    def from_diagnostic(cls, diagnostic: Diagnostic) -> DiagnosticResponse:
        return cls.model_validate(diagnostic.model_dump())


def redacted_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "format",
        "mode",
        "channels",
        "width",
        "height",
        "dtype",
        "shape",
        "unit",
        "icc_profile",
        "exif_orientation",
    }
    return {key: value for key, value in metadata.items() if key in allowed}
