from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Diagnostic(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    code: str = Field(min_length=1, pattern=r"^[A-Z][A-Z0-9_]*$")
    severity: Literal["info", "warning", "fatal"]
    field: str | None = None
    message: str = Field(min_length=1)
    hint: str | None = None
    capability: str | None = None
