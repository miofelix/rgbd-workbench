from __future__ import annotations

import io
import mimetypes
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import numpy as np
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from PIL import Image
from starlette.middleware.base import BaseHTTPMiddleware

from rgbd_workbench import APP_VERSION
from rgbd_workbench.adapters.base import ProbeCandidate
from rgbd_workbench.adapters.manifest import probe_manifest
from rgbd_workbench.adapters.registry import AdapterRegistry
from rgbd_workbench.api.auth import COOKIE_NAME, SessionAuth
from rgbd_workbench.api.schemas import (
    DiagnosticResponse,
    MetadataUpdate,
    redacted_metadata,
)
from rgbd_workbench.domain.contracts import (
    DepthSpec,
    SceneManifestV1,
    SourceRef,
    capability_report,
)
from rgbd_workbench.domain.diagnostics import Diagnostic
from rgbd_workbench.workspace.store import StagedFile, WorkspaceStore

DEFAULT_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024


@dataclass(slots=True)
class ImportSession:
    import_id: str
    staged: dict[str, StagedFile]
    candidates: dict[str, ProbeCandidate]
    manifest_candidate: ProbeCandidate | None = None
    metadata: MetadataUpdate | None = None
    scene: SceneManifestV1 | None = None
    diagnostics: list[Diagnostic] = field(default_factory=list)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; connect-src 'self'",
        )
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response


def _diagnostics(items: list[Diagnostic]) -> list[dict[str, Any]]:
    return [DiagnosticResponse.from_diagnostic(item).model_dump() for item in items]


def _source_summary(source: SourceRef) -> dict[str, Any]:
    return {
        "source_id": source.source_id,
        "role": source.role,
        "filename": source.filename,
        "sha256_prefix": source.sha256[:12],
        "size_bytes": source.size_bytes,
        "width": source.width,
        "height": source.height,
        "dtype": source.dtype,
    }


def _scene_summary(
    scene: SceneManifestV1,
    diagnostics: list[Diagnostic] | tuple[Diagnostic, ...] = (),
) -> dict[str, Any]:
    report = capability_report(scene, diagnostics)
    return {
        "schema_version": scene.schema_version,
        "scene_id": scene.scene_id,
        "display_name": scene.display_name,
        "rgb": _source_summary(scene.rgb),
        "depth": _source_summary(scene.depth),
        "depth_spec": scene.depth_spec.model_dump(mode="json") if scene.depth_spec else None,
        "camera": scene.camera.model_dump(mode="json") if scene.camera else None,
        "alignment": scene.alignment.model_dump(mode="json") if scene.alignment else None,
        "frame_id": scene.frame_id,
        "coordinate_convention": scene.coordinate_convention,
        "normalizer_version": scene.normalizer_version,
        "adapter_versions": scene.adapter_versions,
        "capabilities": report.model_dump(),
        "diagnostics": _diagnostics(list(diagnostics)),
    }


def _candidate_summary(candidate: ProbeCandidate) -> dict[str, Any]:
    return {
        "role": candidate.role,
        "source": _source_summary(candidate.source),
        "metadata": redacted_metadata(candidate.metadata),
        "diagnostics": _diagnostics(candidate.diagnostics),
    }


def _build_scene(session: ImportSession) -> SceneManifestV1:
    metadata = session.metadata or MetadataUpdate()
    depth_spec = None
    if metadata.representation is not None:
        try:
            depth_spec = DepthSpec(
                representation=metadata.representation,  # type: ignore[arg-type]
                unit=metadata.unit,  # type: ignore[arg-type]
                scale_to_meter=metadata.scale_to_meter,
                invalid_values=metadata.invalid_values,
                valid_min=metadata.valid_min,
                valid_max=metadata.valid_max,
            )
        except Exception as exc:
            raise ValueError(str(exc)) from exc
    elif any(item is not None for item in (metadata.unit, metadata.scale_to_meter)) or bool(
        metadata.invalid_values
    ):
        raise ValueError("representation is required when depth semantics are supplied")
    rgb = session.candidates["rgb"].source
    depth = session.candidates["depth"].source
    return SceneManifestV1(
        schema_version=1,
        scene_id=f"scene-{session.import_id}",
        display_name=metadata.display_name or "Untitled Scene",
        rgb=rgb,
        depth=depth,
        depth_spec=depth_spec,
        camera=metadata.camera,
        alignment=metadata.alignment,
        normalizer_version="1",
        adapter_versions={"rgb": "1", "depth": "1"},
    )


def _metadata_from_manifest(candidate: ProbeCandidate) -> MetadataUpdate:
    document = candidate.metadata
    nested_depth = document.get("depth")
    depth: dict[str, Any] = nested_depth if isinstance(nested_depth, dict) else document
    representation = depth.get("representation") or depth.get("type")
    unit = depth.get("unit")
    alignment_value = document.get("alignment")
    if isinstance(alignment_value, str):
        alignment = {"state": alignment_value}
    elif isinstance(alignment_value, dict):
        alignment = alignment_value
    else:
        alignment = None
    camera = document.get("camera")
    payload: dict[str, Any] = {
        "display_name": document.get("display_name"),
        "representation": representation,
        "unit": unit,
        "scale_to_meter": depth.get("scale_to_meter"),
        "invalid_values": depth.get("invalid_values", []),
        "valid_min": depth.get("valid_min"),
        "valid_max": depth.get("valid_max"),
        "camera": camera,
        "alignment": alignment,
    }
    return MetadataUpdate.model_validate(
        {key: value for key, value in payload.items() if value is not None}
    )


def _bind_staged_candidate(
    candidate: ProbeCandidate,
    staged_file: StagedFile,
) -> ProbeCandidate:
    return ProbeCandidate(
        role=candidate.role,
        source=candidate.source.model_copy(
            update={
                "source_id": staged_file.source_id,
                "filename": staged_file.filename,
                "sha256": staged_file.sha256,
                "size_bytes": staged_file.size_bytes,
            }
        ),
        metadata=candidate.metadata,
        diagnostics=candidate.diagnostics,
        path=candidate.path,
    )


def seed_import_from_paths(
    application: FastAPI,
    rgb_path: Path,
    depth_path: Path,
    manifest_path: Path | None = None,
    *,
    linked: bool = False,
) -> str:
    """Register a CLI-selected import in a freshly-created app session."""
    store: WorkspaceStore = application.state.workspace_store
    registry = AdapterRegistry.default()
    import_id = secrets.token_hex(12)
    staged: dict[str, StagedFile] = {}
    candidates: dict[str, ProbeCandidate] = {}
    for role, path in (("rgb", rgb_path), ("depth", depth_path)):
        if linked:
            source = store.register_linked(path, role)  # type: ignore[arg-type]
            candidate = registry.probe(path, role)
            candidates[role] = ProbeCandidate(
                role=candidate.role,
                source=source.model_copy(
                    update={
                        "width": candidate.source.width,
                        "height": candidate.source.height,
                        "dtype": candidate.source.dtype,
                    }
                ),
                metadata=candidate.metadata,
                diagnostics=candidate.diagnostics,
                path=candidate.path,
            )
        else:
            with path.open("rb") as stream:
                staged_file = store.stage_bytes(
                    path.name,
                    stream,
                    application.state.max_upload_bytes,
                )
            staged[role] = staged_file
            candidates[role] = _bind_staged_candidate(
                registry.probe(staged_file.path, role), staged_file
            )
    manifest_candidate = probe_manifest(manifest_path) if manifest_path else None
    session = ImportSession(import_id, staged, candidates, manifest_candidate)
    if manifest_candidate:
        session.metadata = _metadata_from_manifest(manifest_candidate)
    session.scene = _build_scene(session)
    session.diagnostics = [
        item for candidate in candidates.values() for item in candidate.diagnostics
    ]
    application.state.imports[import_id] = session
    return import_id


def create_app(
    workspace_root: Path,
    session_token: str | None = None,
    *,
    max_upload_bytes: int = DEFAULT_UPLOAD_BYTES,
) -> FastAPI:
    store = WorkspaceStore(workspace_root)
    store.initialize()
    registry = AdapterRegistry.default()
    auth = SessionAuth(session_token)
    imports: dict[str, ImportSession] = {}
    app = FastAPI(title="RGB-D Lab", docs_url=None, redoc_url=None)
    app.state.session_cookie = auth.session_cookie
    app.state.session_token = auth.raw_token
    app.state.workspace_root = store.paths.root
    app.state.workspace_store = store
    app.state.max_upload_bytes = max_upload_bytes
    app.state.imports = imports
    app.add_middleware(SecurityHeadersMiddleware)

    @app.middleware("http")
    async def session_exchange(request: Request, call_next):  # type: ignore[no-untyped-def]
        exchanged = auth.exchange(request)
        if exchanged is not None:
            return exchanged
        return await call_next(request)

    async def require_session(request: Request) -> None:
        if not auth.valid_cookie(request.cookies.get(COOKIE_NAME)):
            raise HTTPException(status_code=401, detail="session required")
        host = request.headers.get("host", "")
        host_name = host.rsplit(":", 1)[0].strip("[]") if host else ""
        allowed_host = host_name in {"127.0.0.1", "localhost", "testserver", "::1"}
        if host and not allowed_host:
            raise HTTPException(status_code=403, detail="loopback host required")
        origin = request.headers.get("origin")
        if origin:
            origin_host = urlsplit(origin).hostname
            if origin_host not in {"127.0.0.1", "localhost", "testserver", "::1"}:
                raise HTTPException(status_code=403, detail="same-origin request required")

    @app.get("/api/v1/health")
    async def health() -> dict[str, Any]:
        return {"schema_version": 1, "app_version": APP_VERSION, "ready": True}

    @app.get("/api/v1/capabilities", dependencies=[Depends(require_session)])
    async def capabilities() -> dict[str, Any]:
        return {
            "schema_version": 1,
            "decoders": {
                "png": True,
                "jpeg": True,
                "webp": True,
                "tiff": True,
                "npy": True,
                "npz": True,
                "pfm": True,
            },
            "encoders": {"mp4": False, "webm": False, "png_sequence": True},
            "limits": {"max_upload_bytes": max_upload_bytes, "max_pixels": 64 * 1024 * 1024},
        }

    @app.get("/api/v1/scenes", dependencies=[Depends(require_session)])
    async def list_scenes() -> dict[str, Any]:
        return {
            "schema_version": 1,
            "scenes": [
                _scene_summary(scene, store.revalidate_scene(scene.scene_id))
                for scene in store.list_scenes()
            ],
        }

    @app.get("/api/v1/scenes/{scene_id}", dependencies=[Depends(require_session)])
    async def get_scene(scene_id: str) -> dict[str, Any]:
        try:
            scene = store.get_scene(scene_id)
        except (ValueError, FileNotFoundError) as exc:
            raise HTTPException(status_code=404, detail="scene not found") from exc
        diagnostics = store.revalidate_scene(scene_id)
        return {"schema_version": 1, "scene": _scene_summary(scene, diagnostics)}

    @app.get("/api/v1/scenes/{scene_id}/preview/{role}", dependencies=[Depends(require_session)])
    async def scene_preview(scene_id: str, role: str) -> Response:
        if role not in {"rgb", "depth"}:
            raise HTTPException(status_code=404, detail="preview not found")
        scene = store.get_scene(scene_id)
        stale = store.revalidate_scene(scene_id)
        if stale:
            raise HTTPException(status_code=409, detail="scene source is stale or missing")
        source = scene.rgb if role == "rgb" else scene.depth
        path = store.paths.root / "scenes" / scene_id / "sources" / source.filename
        if not path.is_file():
            raise HTTPException(status_code=404, detail="preview not found")
        if role == "rgb":
            media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            return FileResponse(path, media_type=media_type)
        try:
            candidate = registry.probe(path, "depth")
            raw = (
                registry.normalize(candidate, scene).values
                if scene.depth_spec
                else np.asarray(registry.load_depth(candidate), dtype=np.float32)
            )
            valid = np.isfinite(raw) & (raw > 0)
            if not np.any(valid):
                raise ValueError("depth has no positive finite values")
            low, high = np.percentile(raw[valid], [2, 98])
            span = max(float(high - low), 1e-12)
            scaled = np.clip((raw - low) / span, 0, 1)
            gray = np.where(valid, np.round(scaled * 255), 0).astype(np.uint8)
            image = Image.fromarray(gray, mode="L")
            output = io.BytesIO()
            image.save(output, format="PNG")
            output.seek(0)
            return StreamingResponse(output, media_type="image/png")
        except (OSError, ValueError):
            raise HTTPException(status_code=422, detail="depth preview is unavailable")

    @app.post("/api/v1/imports", status_code=201, dependencies=[Depends(require_session)])
    async def create_import(
        rgb: UploadFile = File(...),
        depth: UploadFile = File(...),
        manifest: UploadFile | None = File(default=None),
    ) -> JSONResponse:
        import_id = secrets.token_hex(12)
        staged: dict[str, StagedFile] = {}
        candidates: dict[str, ProbeCandidate] = {}
        try:
            for role, upload in (("rgb", rgb), ("depth", depth)):
                staged_file = store.stage_bytes(
                    upload.filename or f"{role}.bin",
                    upload.file,
                    max_upload_bytes,
                )
                staged[role] = staged_file
                candidates[role] = _bind_staged_candidate(
                    registry.probe(staged_file.path, role), staged_file
                )
            manifest_candidate = None
            if manifest is not None:
                staged_manifest = store.stage_bytes(
                    manifest.filename or "manifest.json", manifest.file, max_upload_bytes
                )
                staged["manifest"] = staged_manifest
                manifest_candidate = probe_manifest(staged_manifest.path)
            session = ImportSession(import_id, staged, candidates, manifest_candidate)
            if manifest_candidate is not None:
                try:
                    session.metadata = _metadata_from_manifest(manifest_candidate)
                except Exception as exc:
                    session.diagnostics.append(
                        Diagnostic(
                            code="MANIFEST_SCHEMA_INVALID",
                            severity="fatal",
                            field="manifest",
                            message="Manifest semantics are invalid.",
                            hint=str(exc),
                            capability="metric_pointcloud",
                        )
                    )
            session.scene = _build_scene(session)
            session.diagnostics.extend(
                item for item in (manifest_candidate.diagnostics if manifest_candidate else [])
            )
            session.diagnostics.extend(
                item for candidate in candidates.values() for item in candidate.diagnostics
            )
            imports[import_id] = session
            report = capability_report(session.scene, session.diagnostics)
            return JSONResponse(
                status_code=201,
                content={
                    "schema_version": 1,
                    "import_id": import_id,
                    "candidates": {
                        role: _candidate_summary(candidate)
                        for role, candidate in candidates.items()
                    },
                    "manifest": (
                        _candidate_summary(manifest_candidate) if manifest_candidate else None
                    ),
                    "diagnostics": _diagnostics(session.diagnostics),
                    "capabilities": report.model_dump(),
                },
            )
        except ValueError as exc:
            for item in staged.values():
                item.path.unlink(missing_ok=True)
            if "limit" in str(exc):
                raise HTTPException(
                    status_code=413,
                    detail="upload exceeds configured byte limit",
                ) from exc
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.get("/api/v1/imports/{import_id}", dependencies=[Depends(require_session)])
    async def get_import(import_id: str) -> dict[str, Any]:
        session = imports.get(import_id)
        if session is None:
            raise HTTPException(status_code=404, detail="import not found")
        report = capability_report(session.scene, session.diagnostics) if session.scene else None
        return {
            "schema_version": 1,
            "import_id": import_id,
            "candidates": {
                role: _candidate_summary(candidate)
                for role, candidate in session.candidates.items()
            },
            "manifest": (
                _candidate_summary(session.manifest_candidate)
                if session.manifest_candidate
                else None
            ),
            "scene": _scene_summary(session.scene, session.diagnostics) if session.scene else None,
            "diagnostics": _diagnostics(session.diagnostics),
            "capabilities": report.model_dump() if report else {},
        }

    @app.put("/api/v1/imports/{import_id}/metadata", dependencies=[Depends(require_session)])
    async def update_metadata(import_id: str, payload: MetadataUpdate) -> JSONResponse:
        session = imports.get(import_id)
        if session is None:
            raise HTTPException(status_code=404, detail="import not found")
        session.metadata = payload
        try:
            session.scene = _build_scene(session)
        except ValueError as exc:
            diagnostic = Diagnostic(
                code="METADATA_INVALID",
                severity="fatal",
                field="metadata",
                message=str(exc),
                hint="Correct the explicit depth semantics and try again.",
                capability="metric_pointcloud",
            )
            session.diagnostics = [diagnostic]
            return JSONResponse(
                status_code=422,
                content={"diagnostics": _diagnostics(session.diagnostics)},
            )
        session.diagnostics = list(
            session.manifest_candidate.diagnostics if session.manifest_candidate else []
        )
        session.diagnostics.extend(
            item for candidate in session.candidates.values() for item in candidate.diagnostics
        )
        report = capability_report(session.scene, session.diagnostics)
        return JSONResponse(
            content={
                "schema_version": 1,
                "import_id": import_id,
                "scene": _scene_summary(session.scene, session.diagnostics),
                "candidates": {
                    role: _candidate_summary(candidate)
                    for role, candidate in session.candidates.items()
                },
                "manifest": (
                    _candidate_summary(session.manifest_candidate)
                    if session.manifest_candidate
                    else None
                ),
                "diagnostics": _diagnostics(session.diagnostics),
                "capabilities": report.model_dump(),
            }
        )

    @app.post(
        "/api/v1/imports/{import_id}/commit",
        status_code=201,
        dependencies=[Depends(require_session)],
    )
    async def commit_import(import_id: str) -> JSONResponse:
        session = imports.get(import_id)
        if session is None or session.scene is None:
            raise HTTPException(status_code=404, detail="import not found")
        try:
            managed_sources = {
                role: staged for role, staged in session.staged.items() if role in {"rgb", "depth"}
            }
            scene = store.commit_scene(session.scene, managed_sources)
            if "manifest" in session.staged:
                session.staged["manifest"].path.unlink(missing_ok=True)
        except (ValueError, FileExistsError, OSError) as exc:
            raise HTTPException(status_code=422, detail="import cannot be committed") from exc
        imports.pop(import_id, None)
        return JSONResponse(
            status_code=201,
            content={
                "schema_version": 1,
                "scene": _scene_summary(scene, store.revalidate_scene(scene.scene_id)),
            },
        )

    @app.get("/", include_in_schema=False)
    async def root_page() -> FileResponse:
        candidate = Path(__file__).resolve().parents[3] / "dist" / "web" / "index.html"
        fallback = Path(__file__).resolve().parents[3] / "web" / "index.html"
        return FileResponse(candidate if candidate.is_file() else fallback, media_type="text/html")

    @app.get("/assets/{asset_path:path}", include_in_schema=False)
    async def static_asset(asset_path: str) -> FileResponse:
        root = (Path(__file__).resolve().parents[3] / "dist" / "web" / "assets").resolve()
        target = (root / asset_path).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise HTTPException(status_code=404, detail="asset not found")
        return FileResponse(target)

    return app
