# RGB-D Workbench M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first independently runnable milestone of `rgbd-workbench`: a local service that safely imports a single RGB/depth pair, records an immutable normalized Scene, reports capability-gated diagnostics, and presents a browser-based 2D inspection view.

**Architecture:** Use a Python 3.11+ FastAPI service as the source of truth for staged imports, Pydantic Scene contracts, workspace transactions, and format diagnostics. Use a React/TypeScript/Vite shell for the RGB-D Lab UI; M1 deliberately stops before point-cloud derivation, Three.js rendering, trajectories, and video jobs, but exposes explicit disabled capabilities so M2 can add them without changing the import contract.

**Tech Stack:** Python 3.11+, Hatchling, FastAPI, Pydantic v2, Typer, NumPy, Pillow, tifffile, PyYAML safe loader, `imageio-ffmpeg`; TypeScript strict, React, Vite, TanStack Query, Zustand, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-rgbd-workbench-design.md`

## Global Constraints

- The project lives at `/Users/felix/Projects/rgbd-workbench` and has no runtime import, submodule, symlink, or path dependency on `asdepth-grasp`.
- Python is 3.11 or newer; the first supported platforms are macOS and Linux.
- The service binds only to `127.0.0.1`; browser APIs never accept arbitrary local filesystem paths.
- Extensions identify decoders only; depth representation, units, invalid values, intrinsics, and alignment are never guessed.
- RGB/depth source files are read-only; all workspace writes use staging plus atomic publication.
- Managed imports copy source files into the workspace; Linked imports are CLI-only and store a private locator plus SHA-256.
- Core M1 formats are PNG, JPEG, WebP, TIFF for RGB; single-channel PNG/TIFF, NPY, NPZ, PFM, and manifest-described RAW/BIN for depth.
- NPY/NPZ loading uses `allow_pickle=False`; object arrays, malformed payloads, oversized inputs, and unsafe YAML tags are rejected.
- The normalized depth array is finite `numpy.float32`, C-contiguous, two-dimensional; only positive values are valid.
- M1 accepts only already registered-to-RGB, same-size, pinhole, undistorted metadata for metric/relative geometry capabilities; it never resizes or silently registers images.
- Every user-visible failure is a structured diagnostic with `code`, `severity`, `field`, `message`, `hint`, and `capability`; responses do not expose absolute paths or raw manifests.
- No camera SDK, CUDA, model, robot, Open3D, or `asdepth-grasp` dependency is allowed.
- Do not implement M2 point-cloud rendering or M3 trajectory/video behavior in this plan.

## Review Focus

- A 16-bit PNG whose values are millimeters must remain unusable for metric geometry until the user explicitly confirms `mm` or `scale_to_meter`; Task 4 tests the gate.
- A relative-depth PFM must be inspectable and labeled `unitless`, while metric measurement remains disabled; Task 4 and Task 6 test this.
- A malicious NPY/NPZ/YAML or oversized image must fail before decoding unbounded data; Task 4 tests parser limits and Task 5 tests HTTP upload limits.
- A stale or missing Linked source must invalidate its Scene capability and cache identity instead of serving old data; Task 3 tests revalidation.
- A late import response or a Scene switch must not overwrite the current browser state; Task 6 tests revision/request guards.

## File Map

M1 creates the following focused boundaries:

```text
pyproject.toml
package.json
package-lock.json
vite.config.ts
tsconfig.json
src/rgbd_workbench/
  __init__.py
  version.py
  domain/contracts.py
  domain/diagnostics.py
  domain/canonical.py
  workspace/store.py
  workspace/paths.py
  adapters/base.py
  adapters/image.py
  adapters/depth.py
  adapters/manifest.py
  adapters/registry.py
  api/app.py
  api/auth.py
  api/schemas.py
  cli/main.py
web/src/
  main.tsx
  app/App.tsx
  app/app.css
  api/client.ts
  api/types.ts
  state/workbench.ts
  features/import/ImportWizard.tsx
  features/inspect/SceneInspector.tsx
  features/inspect/DepthPreview.tsx
  features/inspect/StatisticsPanel.tsx
tests/
  python/test_toolchain.py
  python/test_contracts.py
  python/test_canonical.py
  python/test_workspace_store.py
  python/test_adapters.py
  python/test_api.py
  python/test_cli.py
  python/test_doctor.py
  python/test_m1_integration.py
  web/toolchain.test.ts
  web/import-wizard.test.tsx
  web/workbench-state.test.ts
  e2e/m1-import.spec.ts
```

M1 also creates `schemas/scene-manifest-v1.json` and `schemas/diagnostic-v1.json` from the Pydantic models, plus `README.md`, `.gitignore`, and `scripts/check-generated-schemas.py`.

### Task 1: Toolchain, generated schema contract, and test harness

**Files:**
- Create: `pyproject.toml`, `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`
- Create: `.gitignore`, `src/rgbd_workbench/__init__.py`, `src/rgbd_workbench/version.py`, `web/index.html`, `web/src/main.tsx`
- Create: `tests/conftest.py`, `tests/web/setup.ts`, `scripts/check-generated-schemas.py`
- Test: `tests/python/test_toolchain.py`, `tests/web/toolchain.test.ts`

**Interfaces:**
- Produces the `rgbd_workbench` import package, the `rgbd-workbench` console entry point, a Vite development server, and test commands used by every later task.
- `src/rgbd_workbench/version.py` exports `APP_VERSION: str = "0.1.0"`.

- [ ] **Step 1: Write failing toolchain tests.**

```python
def test_package_version_and_console_module_are_importable():
    from rgbd_workbench.version import APP_VERSION
    assert APP_VERSION == "0.1.0"
```

```ts
import { describe, expect, it } from "vitest";

describe("frontend toolchain", () => {
  it("loads a strict TypeScript entrypoint", async () => {
    const module = await import("../../web/src/main");
    expect(module).toHaveProperty("mountRgbdLab");
  });
});
```

- [ ] **Step 2: Run the focused tests and verify they fail because the package and entrypoint do not exist.**

Run: `python -m pytest tests/python/test_toolchain.py -q && npm test -- --run tests/web/toolchain.test.ts`

Expected: FAIL with missing package/module errors.

- [ ] **Step 3: Add the minimal project metadata and empty mount entrypoint.**

`pyproject.toml` must declare Hatchling, `src` layout, Python `>=3.11`, runtime dependencies, optional `formats-exr` and `dev` extras, and the `rgbd-workbench = rgbd_workbench.cli.main:main` script. `package.json` must declare React, Vite, TypeScript, TanStack Query, Zustand, Vitest, Testing Library, Playwright, ESLint and Prettier with exact lockfile versions. Run `python -m pip install -e '.[dev]'` and `npm install` to produce the lockfile and local test tools. `main.tsx` exports `mountRgbdLab()` and mounts a temporary `<div data-testid="rgbd-lab-root">`.

- [ ] **Step 4: Run all toolchain checks.**

Run: `python -m pytest tests/python/test_toolchain.py -q && npm test -- --run tests/web/toolchain.test.ts && npm run typecheck`

Expected: PASS; TypeScript strict mode reports no implicit `any`.

- [ ] **Step 5: Commit the runnable toolchain.**

```bash
git add pyproject.toml package.json package-lock.json vite.config.ts tsconfig.json vitest.config.ts playwright.config.ts .gitignore src tests web scripts
git commit -m "chore: bootstrap rgbd workbench toolchain"
```

### Task 2: Domain contracts, diagnostics, canonical bytes, and schema generation

**Files:**
- Create: `src/rgbd_workbench/domain/contracts.py`, `src/rgbd_workbench/domain/diagnostics.py`, `src/rgbd_workbench/domain/canonical.py`
- Create: `schemas/scene-manifest-v1.json`, `schemas/diagnostic-v1.json`
- Modify: `scripts/check-generated-schemas.py`
- Test: `tests/python/test_contracts.py`, `tests/python/test_canonical.py`

**Interfaces:**
- `Diagnostic(code: str, severity: Literal["info", "warning", "fatal"], field: str | None, message: str, hint: str | None, capability: str | None)`.
- `SceneManifestV1`, `SourceRef`, `DepthSpec`, `CameraSpec`, `AlignmentSpec`, `CapabilityReport`, and `ProcessingSpecV1` are Pydantic models with `schema_version` fixed to `1`.
- `canonical_json_bytes(value: BaseModel | Mapping[str, Any]) -> bytes` uses RFC 8785-compatible stable JSON with UTF-8 and rejects NaN/Infinity.
- `sha256_bytes(data: bytes) -> str`, `scene_hash(source_hashes: Mapping[str, str], manifest: SceneManifestV1, normalizer_version: str) -> str`, and `derivation_key(scene_hash_value: str, processing: ProcessingSpecV1, processor_version: str) -> str` return lowercase hex SHA-256.
- `capability_report(manifest: SceneManifestV1, diagnostics: Sequence[Diagnostic]) -> CapabilityReport` never infers missing metadata.

- [ ] **Step 1: Write failing contract and canonicalization tests.**

Cover: valid/invalid `fx`, `fy`, dimensions, representation/unit combinations; `z_depth` versus `relative_z`; diagnostic JSON shape; stable key ordering; Unicode UTF-8; rejection of non-finite values; hash changes when source hash or semantic metadata changes; capability downgrade when intrinsics or alignment are absent.

- [ ] **Step 2: Run the focused tests to observe the missing model/function failures.**

Run: `python -m pytest tests/python/test_contracts.py tests/python/test_canonical.py -q`

Expected: FAIL because the domain modules and schemas do not exist.

- [ ] **Step 3: Implement Pydantic v2 models and canonical hash helpers.**

Use strict numeric validation, explicit enum literals, `extra="forbid"`, and model serializers that preserve unitless versus metric semantics. Reject `relative_z` with a scale, reject metric `z_depth` without a declared unit/scale, and reject geometry capability metadata unless RGB/depth sizes match and alignment is `registered_to_rgb`.

- [ ] **Step 4: Generate and verify JSON schemas.**

`scripts/check-generated-schemas.py` imports the models, writes canonical pretty JSON only when invoked with `--write`, and otherwise exits nonzero on drift. Store only the two versioned schemas in `schemas/`.

- [ ] **Step 5: Run contract tests and schema drift check.**

Run: `python -m pytest tests/python/test_contracts.py tests/python/test_canonical.py -q && python scripts/check-generated-schemas.py`

Expected: PASS with no schema drift.

- [ ] **Step 6: Commit the contract layer.**

```bash
git add src/rgbd_workbench/domain schemas scripts/check-generated-schemas.py tests/python/test_contracts.py tests/python/test_canonical.py
git commit -m "feat: add versioned scene contracts and diagnostics"
```

### Task 3: Workspace paths, atomic storage, Managed/Linked sources, and revalidation

**Files:**
- Create: `src/rgbd_workbench/workspace/paths.py`, `src/rgbd_workbench/workspace/store.py`
- Test: `tests/python/test_workspace_store.py`

**Interfaces:**
- `WorkspacePaths(root: Path)` exposes `staging`, `scenes`, `jobs`, `cache`, and `exports` under a validated root.
- `WorkspaceStore(root: Path)` provides `initialize()`, `stage_bytes(name: str, data: BinaryIO, max_bytes: int) -> StagedFile`, `register_linked(path: Path, role: Literal["rgb", "depth", "manifest"]) -> SourceRef`, `commit_scene(manifest: SceneManifestV1, staged: Mapping[str, StagedFile]) -> SceneManifestV1`, `get_scene(scene_id: str) -> SceneManifestV1`, `list_scenes() -> list[SceneManifestV1]`, and `revalidate_scene(scene_id: str) -> list[Diagnostic]`.
- Staged writes use a sibling temporary file, `fsync`, and `os.replace`; `commit_scene` is all-or-nothing.

- [ ] **Step 1: Write failing storage tests.**

Cover directory creation, max-byte enforcement, atomic cleanup after exceptions, filename sanitization, SHA-256 recording, Managed source copying, Linked source canonicalization, symlink escape rejection, missing/stale revalidation, and source-file immutability.

- [ ] **Step 2: Run storage tests and observe failures.**

Run: `python -m pytest tests/python/test_workspace_store.py -q`

Expected: FAIL with missing `WorkspacePaths`, `WorkspaceStore`, and `StagedFile`.

- [ ] **Step 3: Implement validated workspace paths and atomic staging.**

Resolve the root once, reject root `/`, reject paths outside root after `resolve()`, forbid symlinks in write destinations, enforce byte counts while streaming, and remove temporary files in `finally` blocks.

- [ ] **Step 4: Implement Managed and Linked source records.**

Managed records point only to `scenes/<id>/sources/<safe-name>` and include file size/hash. Linked records retain a private canonical locator only inside `scene.json`; API serializers in Task 5 redact it. Revalidation compares existence, size, mtime and SHA-256 and returns `missing` or `stale` diagnostics without deleting old exports.

- [ ] **Step 5: Run storage tests and a source immutability check.**

Run: `python -m pytest tests/python/test_workspace_store.py -q`

Expected: PASS; fixture input bytes and previously committed Scene JSON remain byte-identical after revalidation.

- [ ] **Step 6: Commit workspace storage.**

```bash
git add src/rgbd_workbench/workspace tests/python/test_workspace_store.py
git commit -m "feat: add atomic rgbd workspace storage"
```

### Task 4: RGB/depth/manifest adapters and normalization diagnostics

**Files:**
- Create: `src/rgbd_workbench/adapters/base.py`, `src/rgbd_workbench/adapters/image.py`, `src/rgbd_workbench/adapters/depth.py`, `src/rgbd_workbench/adapters/manifest.py`, `src/rgbd_workbench/adapters/registry.py`
- Test: `tests/python/test_adapters.py`

**Interfaces:**
- `ProbeCandidate(role: Literal["rgb", "depth", "manifest"], source: SourceRef, metadata: dict[str, Any], diagnostics: list[Diagnostic])`.
- `AdapterRegistry.default() -> AdapterRegistry`, `AdapterRegistry.probe(path: Path, role: str) -> ProbeCandidate`, and `AdapterRegistry.normalize(depth_candidate: ProbeCandidate, manifest: SceneManifestV1) -> NormalizedDepth`.
- `NormalizedDepth(values: np.ndarray, valid: np.ndarray, representation: Literal["z_depth", "relative_z"], unit: Literal["m", "unitless"], source_shape: tuple[int, int])`.
- JSON/YAML manifest loading is safe, size-limited, schema-validated, and never loads custom YAML tags.

- [ ] **Step 1: Write fixture-driven failing adapter tests.**

Generate tiny RGB PNG/JPEG/WebP/TIFF files, 8/16-bit depth PNG/TIFF, float TIFF, NPY, NPZ with one and multiple arrays, PFM, malformed RAW, invalid object NPY, NaN/Inf arrays, unsupported channels, invalid YAML tags, and oversized/declaration-mismatch cases. Assert diagnostics identify the role and capability without leaking paths.

- [ ] **Step 2: Run adapter tests to observe missing adapter failures.**

Run: `python -m pytest tests/python/test_adapters.py -q`

Expected: FAIL because the adapter registry and normalizers do not exist.

- [ ] **Step 3: Implement bounded RGB probes.**

Use Pillow with decompression-bomb limits, normalize display RGB to contiguous `uint8`/`uint8[H,W,3]`, preserve source dimensions and alpha/ICC diagnostics, and reject unsupported orientation changes instead of silently rotating.

- [ ] **Step 4: Implement bounded depth probes and PFM/RAW readers.**

Use `allow_pickle=False`, reject object arrays, require exactly two dimensions, enforce element/byte limits before allocation where possible, parse PFM endianness and scale, and require manifest shape/dtype/endianness for RAW/BIN. Do not assign units during probing.

- [ ] **Step 5: Implement manifest loading and explicit normalization.**

Accept only user-declared representation/unit/invalid/scale. Match invalid sentinels before scaling, convert valid values to finite C-contiguous float32, preserve `relative_z` as unitless, and produce fatal diagnostics for missing semantics, mismatched shape, unconfirmed alignment, or invalid intrinsics.

- [ ] **Step 6: Run adapter tests and all domain tests.**

Run: `python -m pytest tests/python/test_adapters.py tests/python/test_contracts.py tests/python/test_canonical.py -q`

Expected: PASS, including the Review Focus cases for millimeters, relative PFM, malicious arrays/YAML, and no implicit inference.

- [ ] **Step 7: Commit adapters.**

```bash
git add src/rgbd_workbench/adapters tests/python/test_adapters.py
git commit -m "feat: add explicit rgbd format adapters"
```

### Task 5: Local API, session authentication, staged imports, and Scene endpoints

**Files:**
- Create: `src/rgbd_workbench/api/auth.py`, `src/rgbd_workbench/api/schemas.py`, `src/rgbd_workbench/api/app.py`, `src/rgbd_workbench/cli/main.py`
- Modify: `src/rgbd_workbench/__init__.py`
- Test: `tests/python/test_api.py`, `tests/python/test_cli.py`

**Interfaces:**
- `create_app(workspace_root: Path, session_token: str | None = None) -> FastAPI`.
- `GET /api/v1/health` is unauthenticated and returns `{ "schema_version": 1, "app_version": "0.1.0", "ready": true }`.
- All other `/api/v1` routes require a signed/random session cookie; the one-time query token is exchanged for `HttpOnly; SameSite=Strict` cookie and then redirected to a token-free URL.
- `POST /api/v1/imports` accepts multipart `rgb`, `depth`, optional `manifest`, and returns `import_id`, probe candidates, diagnostics, and capabilities.
- `PUT /api/v1/imports/{id}/metadata` accepts only explicit semantic fields and returns updated diagnostics/capabilities.
- `POST /api/v1/imports/{id}/commit` creates a Scene atomically; `GET /api/v1/scenes` and `GET /api/v1/scenes/{id}` return redacted Scene summaries.
- `GET /api/v1/capabilities` reports decoder/encoder availability without reading user image content.
- `main()` exposes `serve`, `open`, `doctor`, and `workspace pack/unpack` command groups, with `--workspace-root` overriding TOML config.

- [ ] **Step 1: Write failing API/CLI tests.**

Cover health without cookie, rejection of unauthenticated business routes, token exchange and no token in redirect URL, loopback binding, upload byte limits, malformed multipart, redacted paths, import probe/metadata/commit flow, missing manifest semantics, and CLI help/argument precedence.

- [ ] **Step 2: Run focused tests and observe missing app/CLI failures.**

Run: `python -m pytest tests/python/test_api.py tests/python/test_cli.py -q`

Expected: FAIL because `create_app` and CLI commands do not exist.

- [ ] **Step 3: Implement auth middleware and safe response serializers.**

Generate a cryptographically random token per process, store only a hash in memory, use `secrets.compare_digest`, validate Host/Origin, set CSP/nosniff/no-store headers, and ensure diagnostic serializers remove canonical paths and raw manifest data.

- [ ] **Step 4: Implement import lifecycle endpoints.**

Create a bounded import session in staging, probe each uploaded role through `AdapterRegistry`, accept only metadata fields allowed by `SceneManifestV1`, recompute diagnostics/capabilities after every confirmation, and commit only when the source pair and explicit semantics are valid for the requested capability. Keep image-only Scenes available when geometry metadata is incomplete.

- [ ] **Step 5: Implement CLI/config precedence and static serving hook.**

Read `platformdirs.user_config_dir("rgbd-workbench")/config.toml`, then apply environment overrides documented in `doctor`, then CLI arguments. `serve` binds loopback and prints the URL; `open` stages files and starts/opens the server unless `--no-open`; no command accepts a web-supplied filesystem path.

- [ ] **Step 6: Run API, CLI, adapter, and contract tests.**

Run: `python -m pytest tests/python/test_api.py tests/python/test_cli.py tests/python/test_adapters.py tests/python/test_contracts.py tests/python/test_workspace_store.py -q`

Expected: PASS; API output contains IDs and summaries only, never fixture absolute paths.

- [ ] **Step 7: Commit the M1 backend API.**

```bash
git add src/rgbd_workbench/api src/rgbd_workbench/cli src/rgbd_workbench/__init__.py tests/python/test_api.py tests/python/test_cli.py
git commit -m "feat: add local rgbd import api"
```

### Task 6: RGB-D Lab M1 browser shell and 2D inspection workflow

**Files:**
- Create: `web/src/app/App.tsx`, `web/src/app/app.css`, `web/src/api/client.ts`, `web/src/api/types.ts`, `web/src/state/workbench.ts`, `web/src/features/import/ImportWizard.tsx`, `web/src/features/inspect/SceneInspector.tsx`, `web/src/features/inspect/DepthPreview.tsx`, `web/src/features/inspect/StatisticsPanel.tsx`
- Modify: `web/src/main.tsx`, `vite.config.ts`
- Test: `tests/web/import-wizard.test.tsx`, `tests/web/workbench-state.test.ts`, `tests/e2e/m1-import.spec.ts`

**Interfaces:**
- `api/client.ts` exports typed `probeImport(files)`, `confirmImport(importId, metadata)`, `commitImport(importId)`, `listScenes()`, `getScene(sceneId)`, and `getCapabilities()` using `/api/v1` only.
- `state/workbench.ts` exports a Zustand store with `activeSceneId`, `activeMode: "inspect" | "compare" | "trajectory"`, `importSession`, `draftMetadata`, `appliedScene`, `diagnostics`, and revision-safe async actions.
- `App` must render the confirmed analysis-first layout: top bar, Scene list/capability rail, central RGB/depth inspection canvas area, right diagnostics inspector, and a disabled-but-labeled point-cloud/video capability state.

- [ ] **Step 1: Write failing component/store tests.**

Cover rendering probe diagnostics, explicit unit/representation controls, disabling metric actions when capability is absent, successful commit and Scene selection, stale response rejection after changing Scene, `relative_z` unitless labels, and no path text in rendered DOM.

- [ ] **Step 2: Run web tests to observe missing component/store failures.**

Run: `npm test -- --run tests/web/import-wizard.test.tsx tests/web/workbench-state.test.ts`

Expected: FAIL because the app shell and store do not exist.

- [ ] **Step 3: Implement typed client and revision-safe Zustand store.**

Use `AbortController` per request, attach the current Scene/import revision to every response, and discard responses whose revision no longer matches. Convert structured diagnostics into field-level messages without parsing free-form text.

- [ ] **Step 4: Implement the import wizard.**

Support drag/drop and file picker for Managed RGB/depth files, show detected format/dtype/shape/valid range, require explicit controls for representation, unit/scale, invalid sentinel, alignment, intrinsics, and image orientation when needed, and block commit only for the requested capability. Never expose the server’s absolute staging path.

- [ ] **Step 5: Implement the analysis-first shell and 2D inspection.**

Render RGB and depth previews with `object-fit: contain`, an invalid-mask overlay, percentile/fixed-range controls, histogram/statistics, capability badges, source-read-only status, and the three mode buttons. Keep Four-view and Trajectory mode visible but show the M1 unavailable state rather than fake functionality. Use Lucide icons, keyboard focus states, no external CDN, and responsive CSS with no overlapping panels.

- [ ] **Step 6: Run unit tests, typecheck, and production build.**

Run: `npm test -- --run tests/web/import-wizard.test.tsx tests/web/workbench-state.test.ts && npm run typecheck && npm run build`

Expected: PASS; Vite emits static assets for the Python service.

- [ ] **Step 7: Run the real-browser M1 flow.**

Run: `npm run test:e2e -- tests/e2e/m1-import.spec.ts`

Expected: the browser uploads a fixture RGB/depth pair, confirms metadata, commits a Scene, switches between inspect/compare/trajectory disabled states without overlap, and shows `unitless` or metric labels correctly.

- [ ] **Step 8: Commit the M1 web experience.**

```bash
git add web vite.config.ts tests/web tests/e2e
git commit -m "feat: add rgbd lab import and inspection shell"
```

### Task 7: Doctor command, M1 integration fixtures, docs, and release checks

**Files:**
- Create: `README.md`, `docs/development.md`, `fixtures/m1/`, `tests/python/test_doctor.py`, `tests/python/test_m1_integration.py`, `scripts/run-m1-checks.sh`
- Modify: `src/rgbd_workbench/cli/main.py`, `pyproject.toml`, `package.json`
- Test: `tests/python/test_doctor.py`, `tests/python/test_m1_integration.py`

**Interfaces:**
- `doctor --json` returns stable fields for Python version, workspace writability, frontend asset presence, FFmpeg probe result, optional adapter availability, and configured limits; it does not decode user images.
- `scripts/run-m1-checks.sh` runs Python tests, Ruff, mypy, schema drift, npm tests, typecheck, build, and `git diff --check` with `set -euo pipefail`.
- `README.md` documents only generic project usage, not `asdepth-grasp` machine/profile facts.

- [ ] **Step 1: Write failing doctor and end-to-end fixture tests.**

Use three fixtures: 16-bit PNG millimeters with complete manifest, float32 NPY meters with complete manifest, and PFM relative depth without metric intrinsics. Assert import/commit capability results, redacted API responses, source immutability, and the exact doctor JSON keys.

- [ ] **Step 2: Run integration tests to observe missing doctor/docs behavior.**

Run: `python -m pytest tests/python/test_doctor.py tests/python/test_m1_integration.py -q`

Expected: FAIL because doctor, fixtures, and integration flow are incomplete.

- [ ] **Step 3: Implement doctor and stable fixtures.**

Keep fixture dimensions small, store expected hashes in the test, and make doctor report missing optional extras as capability warnings rather than failures. Add `--json` output with no absolute paths.

- [ ] **Step 4: Write README/development instructions and the M1 check script.**

Document `uv sync`, `npm ci`, `rgbd-workbench serve`, `rgbd-workbench open`, manifest fields, Managed/Linked distinction, supported formats, unitless limits, local-only security, and the fact that M2/M3 capabilities are not yet available. Do not mention current machine values or private paths.

- [ ] **Step 5: Run the complete M1 verification command.**

Run: `bash scripts/run-m1-checks.sh`

Expected: all Python/web checks pass, generated schemas are clean, production assets exist, and `git diff --check` is clean.

- [ ] **Step 6: Commit M1 completion.**

```bash
git add README.md docs/development.md fixtures tests scripts/run-m1-checks.sh src/rgbd_workbench/cli pyproject.toml package.json
git commit -m "feat: complete rgbd workbench m1 foundation"
```

## M1 Completion Contract

M1 is complete only when all of the following are true:

- `rgbd-workbench serve --workspace-root <temp>` starts a loopback-only server and serves the built React app.
- A Managed import of a metric PNG/NPY pair requires explicit semantics and produces a Scene with `metric_pointcloud` capability only when the full geometry contract is present.
- A relative-depth import remains usable for 2D inspection and is labeled `unitless`; metric actions are disabled.
- Invalid, oversized, malicious, mismatched, missing, and stale inputs produce structured diagnostics and never modify source files.
- API responses contain opaque IDs and redacted summaries, never arbitrary local paths.
- The browser layout is usable at desktop and mobile widths, and late responses cannot overwrite the active Scene.
- `scripts/run-m1-checks.sh` passes on macOS and Linux; no file in `asdepth-grasp` changes.

## Next Plans

After M1 is accepted, create separate reviewed plans for:

1. M2 point-cloud processing, binary payload, Three.js viewer, measurement, and PLY/PNG export.
2. M3 CameraPath conformance, trajectory editor, CPU renderer, FFmpeg jobs, SSE, video layouts, and `.rgbdw` packaging.

Do not begin M2/M3 implementation in the M1 branch without a new plan and review.
