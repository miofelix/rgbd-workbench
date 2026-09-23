# RGB-D Workbench M2 Point Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the M1 RGB-D Lab into a deterministic single-frame point-cloud workbench with server-authoritative derivations, a Three.js viewer, measurement, and static exports.

**Architecture:** Keep Python as the only geometry authority. A synchronous derivation endpoint validates a committed Scene, runs a deterministic ProcessingSpec pipeline, atomically caches a binary point cloud plus PLY/JSON exports, and returns an opaque derivation id. React loads the versioned binary, renders a stable LOD in Three.js, and keeps draft processing separate from the applied derivation; browser PNG is a screenshot of that applied canvas.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, NumPy, SciPy `cKDTree`, Pillow, pytest; React 19, TypeScript strict, Zustand, Three.js, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-rgbd-workbench-m2-design.md`

## Global Constraints

- Preserve M1 import semantics, Managed/Linked source handling, session protection, and redacted API responses.
- Extensions identify decoders only; never infer depth representation, units, intrinsics, alignment, or scale.
- Python is the only geometry authority; the browser must not re-project or re-sample data for exports.
- Derivation keys are `SHA256(canonical(scene_hash + ProcessingSpecV1 + processor_version))`; processor version is `1` for M2.
- Processing is deterministic, ordered by source pixel index, and uses no random numbers.
- A stale or missing source invalidates derivation use and never serves an old cache as current.
- All workspace writes use staging plus atomic publication; partial derivation directories are never visible.
- Unitless relative depth must remain visibly unitless in UI, binary header, PLY comments, JSON, and measurements.
- The browser accepts only opaque ids and approved media routes; no API response may expose absolute paths or raw manifests.
- M2 does not add CameraPath, video jobs, SSE, world frames, mesh generation, or multi-frame processing.
- Any new visible controls use existing Lucide icons, explicit labels/tooltips, focus states, and responsive layouts.

## Review Focus

- A metric Scene with a missing/unknown camera or alignment must return a structured capability gate and must not create a derivation; Task 4 tests this.
- A unitless relative Scene must create a usable unitless point cloud while measurement/export never displays meters; Tasks 2, 4, and 6 test this.
- A corrupted or truncated point-cloud payload must be rejected before typed-array access; Task 2 and Task 5 test this.
- A source changed after caching must invalidate the cache and return `SCENE_SOURCE_STALE`, never reuse old points; Task 3 and Task 4 test this.
- Repeated processing with identical Scene/spec must be byte-identical and report `cached: true`; Task 2 and Task 4 test this.

## File Map

```text
src/rgbd_workbench/domain/contracts.py       # DerivationManifestV1 and array descriptors
src/rgbd_workbench/domain/canonical.py       # existing hash helpers, versioned inputs
src/rgbd_workbench/processing/__init__.py
src/rgbd_workbench/processing/pointcloud.py  # deterministic geometry pipeline
src/rgbd_workbench/processing/protocol.py    # binary payload, PLY, JSON serialization
src/rgbd_workbench/workspace/store.py        # source resolution and atomic derivation cache
src/rgbd_workbench/api/app.py                # derivation and export routes
schemas/derivation-manifest-v1.json
web/src/api/client.ts                        # derivation requests/download URLs
web/src/api/types.ts                         # wire types
web/src/state/workbench.ts                   # draft/applied/revision state
web/src/features/pointcloud/                 # parser, viewer, controls, measurement, exports
web/src/viewer/pointcloud-scene.ts           # Three.js lifecycle helper
tests/python/test_pointcloud.py
tests/python/test_pointcloud_protocol.py
tests/python/test_derivation_api.py
tests/web/pointcloud-protocol.test.ts
tests/web/pointcloud-state.test.ts
tests/web/pointcloud-viewer.test.tsx
tests/e2e/m2-pointcloud.spec.ts
```

### Task 1: Domain contracts, generated schema, and cache identity

**Files:**
- Modify: `src/rgbd_workbench/domain/contracts.py`
- Modify: `src/rgbd_workbench/domain/canonical.py`
- Modify: `scripts/check-generated-schemas.py`
- Create: `schemas/derivation-manifest-v1.json`
- Test: `tests/python/test_contracts.py`, `tests/python/test_canonical.py`, `tests/python/test_derivation_contracts.py`

**Interfaces:**
- Add `ArrayDescriptorV1(dtype: Literal[...], shape: tuple[int, ...], offset: StrictInt, nbytes: StrictInt)` with non-negative offsets and exact positive dimensions.
- Add `BoundsV1(min: tuple[FiniteFloat, FiniteFloat, FiniteFloat], max: tuple[FiniteFloat, FiniteFloat, FiniteFloat])` with ordered finite axes.
- Add `DerivationManifestV1(schema_version=1, derivation_id, scene_id, scene_hash, derivation_key, processor_version, processing, point_count, source_shape, frame, unit, representation, bounds, arrays, diagnostics)`.
- Add `PROCESSOR_VERSION = "1"` and `derivation_id_from_key(key: str) -> str` with a lowercase SHA-256 validator.
- Keep `ProcessingSpecV1` strict and add validation for finite ROI/tuple values and `max_points <= 2_000_000`.

- [ ] **Step 1: Write failing contract tests.**

```python
def test_derivation_manifest_rejects_array_that_exceeds_payload():
    with pytest.raises(ValidationError):
        ArrayDescriptorV1(dtype="float32", shape=(2, 3), offset=32, nbytes=4)

def test_derivation_manifest_preserves_unitless_representation():
    manifest = derivation_fixture(unit="unitless", representation="relative_z")
    assert manifest.model_dump(mode="json")["unit"] == "unitless"

def test_derivation_id_is_opaque_and_keyed_by_sha256():
    assert derivation_id_from_key("a" * 64) == "derivation-" + "a" * 64
    with pytest.raises(ValueError):
        derivation_id_from_key("../escape")
```

- [ ] **Step 2: Run the focused tests and observe the expected missing-model failures.**

Run: `./.venv/bin/python -m pytest tests/python/test_derivation_contracts.py -q`

Expected: FAIL because the new contract types and helper do not exist.

- [ ] **Step 3: Implement strict contracts and regenerate the schema.**

Use Pydantic `ConfigDict(extra="forbid", strict=True)`. Validate array byte width from a fixed dtype table
(`float32=4`, `uint8=1`, `uint32=4`) and require `nbytes == product(shape) * itemsize`. Add the derivation
model to the existing schema generation script rather than hand-writing schema JSON.

- [ ] **Step 4: Run contract, canonical, and schema drift tests.**

Run: `./.venv/bin/python -m pytest tests/python/test_contracts.py tests/python/test_canonical.py tests/python/test_derivation_contracts.py -q && ./.venv/bin/python scripts/check-generated-schemas.py`

Expected: all focused tests pass and the generated-schema checker exits 0.

- [ ] **Step 5: Commit the contract boundary.**

```bash
git add src/rgbd_workbench/domain schemas scripts tests/python/test_derivation_contracts.py
git commit -m "feat: add m2 derivation contracts"
```

### Task 2: Deterministic point-cloud processor and binary/PLY serializers

**Files:**
- Create: `src/rgbd_workbench/processing/__init__.py`
- Create: `src/rgbd_workbench/processing/pointcloud.py`
- Create: `src/rgbd_workbench/processing/protocol.py`
- Create: `tests/python/test_pointcloud.py`
- Create: `tests/python/test_pointcloud_protocol.py`

**Interfaces:**
- `PointCloudResult` contains C-contiguous `positions: np.ndarray[float32, N,3]`, `colors: np.ndarray[uint8, N,3]`, `pixel_index: np.ndarray[uint32, N]`, `unit`, `representation`, `bounds`, and diagnostics.
- `build_derivation(scene, rgb, depth, processing) -> PointCloudResult` implements the ordered pipeline in the M2 spec.
- `encode_pointcloud(result, manifest_base) -> bytes` writes the `RGBDPC1\0` protocol and returns a self-validated payload.
- `decode_pointcloud(payload) -> ParsedPointCloud` is a Python test oracle that rejects bad magic, lengths, offsets, dtypes, and total byte counts.
- `encode_ply(result, manifest) -> bytes` writes binary little-endian PLY with source pixel indices and unit/frame comments.
- `derivation_json(manifest) -> bytes` returns canonical UTF-8 JSON with no non-finite values.

- [ ] **Step 1: Write failing geometry and protocol tests.**

```python
def test_pinhole_projection_keeps_source_pixel_order():
    result = build_derivation(metric_scene_2x2(), rgb_2x2(), normalized_depth([[1, 2], [3, 4]]), ProcessingSpecV1())
    np.testing.assert_allclose(result.positions[0], [-0.1, -0.1, 1.0])
    np.testing.assert_array_equal(result.pixel_index, [0, 1, 2, 3])

def test_relative_points_remain_unitless():
    result = build_derivation(relative_scene_2x2(), rgb_2x2(), normalized_relative([[1, 2], [3, 4]]), ProcessingSpecV1())
    assert result.unit == "unitless"

def test_binary_parser_rejects_truncated_array():
    payload = encode_pointcloud(sample_result(), sample_manifest())[:-1]
    with pytest.raises(ValueError, match="payload"):
        decode_pointcloud(payload)

def test_ply_unitless_comment_does_not_claim_meters():
    payload = encode_ply(unitless_result(), unitless_manifest())
    assert b"unit unitless" in payload
    assert b"meters" not in payload
```

- [ ] **Step 2: Run the new tests and verify they fail for missing processing modules.**

Run: `./.venv/bin/python -m pytest tests/python/test_pointcloud.py tests/python/test_pointcloud_protocol.py -q`

Expected: FAIL with import errors for `rgbd_workbench.processing`.

- [ ] **Step 3: Implement the ordered processing pipeline.**

Load only already-normalized `NormalizedDepth`; validate camera/alignment and representation before any
array math. Build row-major coordinate grids, mask invalid values, clip ROI/depth/XYZ, and compute pinhole
XYZ in float32. Implement voxel grouping with sorted representative pixel indices, deterministic stratified
budget selection, and SciPy KNN operations with `k = min(requested, point_count)`; return a `POINTCLOUD_EMPTY`
diagnostic instead of constructing an invalid result.

- [ ] **Step 4: Implement the protocol and export serializers.**

Construct header offsets after 4-byte alignment, append arrays with exact C-order bytes, then parse the result
back before returning. Encode PLY headers with count, binary little endian properties, source index, frame and
unit comments. Use canonical JSON for parameter export and reject non-finite bounds.

- [ ] **Step 5: Run focused and full Python tests.**

Run: `./.venv/bin/python -m pytest tests/python/test_pointcloud.py tests/python/test_pointcloud_protocol.py tests/python/test_contracts.py tests/python/test_canonical.py -q`

Expected: all tests pass with exact 2x2 geometry and byte-stable repeated encodes.

- [ ] **Step 6: Commit the processing core.**

```bash
git add src/rgbd_workbench/processing tests/python/test_pointcloud.py tests/python/test_pointcloud_protocol.py
git commit -m "feat: add deterministic point cloud processing"
```

### Task 3: Workspace source resolution and atomic derivation cache

**Files:**
- Modify: `src/rgbd_workbench/workspace/store.py`
- Modify: `src/rgbd_workbench/workspace/paths.py`
- Create: `tests/python/test_derivation_cache.py`

**Interfaces:**
- `WorkspaceStore.resolve_scene_source(scene_id, role) -> Path` revalidates identity and raises a private error carrying a public diagnostic code.
- `WorkspaceStore.derivation_dir(scene_id, derivation_key) -> Path` validates both ids and returns a root-contained path.
- `WorkspaceStore.read_cached_derivation(scene_id, key) -> CachedDerivation | None` validates manifest, binary size and key.
- `WorkspaceStore.publish_derivation(scene_id, key, files: Mapping[str, bytes]) -> None` atomically publishes all files or none.

- [ ] **Step 1: Write failing cache tests.**

```python
def test_publish_derivation_is_atomic_and_readable(tmp_path):
    store = committed_store(tmp_path)
    store.publish_derivation("scene-1", "a" * 64, {"manifest.json": b"{}", "pointcloud.bin": b"x"})
    assert store.read_cached_derivation("scene-1", "a" * 64)["pointcloud.bin"] == b"x"

def test_changed_managed_source_invalidates_resolution(tmp_path):
    store = committed_store(tmp_path)
    source = store.scene_source_path("scene-1", "depth")
    source.write_bytes(b"changed")
    with pytest.raises(SceneSourceError, match="SCENE_SOURCE_STALE"):
        store.resolve_scene_source("scene-1", "depth")
```

- [ ] **Step 2: Run the tests and observe missing cache APIs.**

Run: `./.venv/bin/python -m pytest tests/python/test_derivation_cache.py -q`

Expected: FAIL because the cache and source-resolution methods do not exist.

- [ ] **Step 3: Implement validated source resolution and atomic publication.**

Use existing `_read_linked_locator` and `_hash_file`; never return locator values through API serializers.
Write files into a unique sibling temp directory, fsync files/directories, verify expected names and key, then
`os.replace` the completed directory. A corrupt cache read returns `None` and removes only that derivation directory.

- [ ] **Step 4: Run workspace regression and cache tests.**

Run: `./.venv/bin/python -m pytest tests/python/test_workspace_store.py tests/python/test_derivation_cache.py -q`

Expected: all existing workspace tests and new cache tests pass.

- [ ] **Step 5: Commit workspace cache support.**

```bash
git add src/rgbd_workbench/workspace tests/python/test_derivation_cache.py
git commit -m "feat: add atomic derivation cache"
```

### Task 4: Derivation API and static exports

**Files:**
- Modify: `src/rgbd_workbench/api/app.py`
- Modify: `src/rgbd_workbench/api/schemas.py`
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`
- Create: `tests/python/test_derivation_api.py`

**Interfaces:**
- `POST /api/v1/scenes/{scene_id}/derivations` accepts `ProcessingSpecV1` and returns `{schema_version, cached, derivation, urls, diagnostics}`.
- `GET /api/v1/derivations/{derivation_id}` returns a redacted `DerivationSummary`.
- `GET /api/v1/derivations/{derivation_id}/pointcloud` returns the binary protocol.
- `GET /api/v1/derivations/{derivation_id}/export/ply|json` returns an attachment with explicit media type.
- Frontend client exports `createDerivation`, `getDerivation`, `derivationPointcloudUrl`, `derivationExportUrl`.

- [ ] **Step 1: Write failing API tests.**

```python
def test_derivation_post_is_idempotent_and_downloads_exports(tmp_path):
    client, scene_id = committed_metric_client(tmp_path)
    first = client.post(f"/api/v1/scenes/{scene_id}/derivations", json={"schema_version": 1})
    second = client.post(f"/api/v1/scenes/{scene_id}/derivations", json={"schema_version": 1})
    assert first.status_code == 201 and second.status_code == 200
    assert second.json()["cached"] is True
    derivation_id = first.json()["derivation"]["derivation_id"]
    binary = client.get(f"/api/v1/derivations/{derivation_id}/pointcloud")
    assert binary.headers["content-type"].startswith("application/vnd.rgbd-workbench.pointcloud-v1")
    assert client.get(f"/api/v1/derivations/{derivation_id}/export/ply").content.startswith(b"ply")

def test_derivation_is_blocked_for_missing_geometry_metadata(tmp_path):
    client, scene_id = committed_unregistered_client(tmp_path)
    response = client.post(f"/api/v1/scenes/{scene_id}/derivations", json={"schema_version": 1})
    assert response.status_code == 422
    assert response.json()["diagnostics"][0]["code"] == "DERIVATION_CAPABILITY_BLOCKED"
```

- [ ] **Step 2: Run focused API tests and verify they fail because routes are absent.**

Run: `./.venv/bin/python -m pytest tests/python/test_derivation_api.py -q`

Expected: FAIL with 404 responses or missing test helpers.

- [ ] **Step 3: Add request/response serializers and route implementation.**

Resolve and revalidate both sources, probe/load through `AdapterRegistry`, normalize depth, compute scene hash
and derivation key, then call `build_derivation`. On a valid cache, skip decoding. Build a full manifest, encode
all files, publish atomically, and return URLs with only opaque ids. Map capability, stale, empty, and resource
errors to structured diagnostic arrays; do not pass exception strings through unchanged.

- [ ] **Step 4: Add client wire types and URL helpers.**

Keep TypeScript wire fields aligned with the Pydantic response. `request<T>` must preserve structured
`diagnostics` from non-2xx responses so the UI can show capability-specific messages.

- [ ] **Step 5: Run all Python API and M1 tests.**

Run: `./.venv/bin/python -m pytest tests/python -q`

Expected: all M1 and M2 Python tests pass with no path text in JSON responses.

- [ ] **Step 6: Commit derivation API.**

```bash
git add src/rgbd_workbench/api web/src/api tests/python/test_derivation_api.py
git commit -m "feat: expose point cloud derivation api"
```

### Task 5: Frontend protocol parser, state, and Three.js viewer

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `web/src/features/pointcloud/pointcloud-protocol.ts`
- Create: `web/src/viewer/pointcloud-scene.ts`
- Create: `web/src/features/pointcloud/PointCloudViewer.tsx`
- Modify: `web/src/state/workbench.ts`
- Modify: `web/src/api/types.ts`, `web/src/api/client.ts`
- Create: `tests/web/pointcloud-protocol.test.ts`, `tests/web/pointcloud-state.test.ts`, `tests/web/pointcloud-viewer.test.tsx`

**Interfaces:**
- `parsePointCloudPayload(buffer: ArrayBuffer) -> ParsedPointCloud` validates the full binary contract and exposes typed views without copying.
- `stableLod(points, maxPoints) -> Uint32Array` returns source-order indices using deterministic stride/partition rules.
- `createPointCloudScene(canvas, options) -> PointCloudSceneHandle` exposes `setPoints`, `resetView`, `pick`, `capturePng`, and `dispose`.
- Zustand adds `draftProcessing`, `appliedProcessing`, `appliedDerivation`, `viewSpec`, `selectedPoints`, `derivationBusy`, `derivationRequestRevision`, `applyProcessing`, and `clearDerivation`.

- [ ] **Step 1: Add Three.js and write failing parser/state tests.**

```typescript
it("rejects a payload whose array offset exceeds the buffer", () => {
  expect(() => parsePointCloudPayload(corruptOffsetPayload())).toThrow(/offset/);
});

it("keeps LOD source order and is stable across calls", () => {
  expect(Array.from(stableLod(1_000_000, 250_000))).toEqual(
    Array.from(stableLod(1_000_000, 250_000)),
  );
});

it("does not let a late derivation response replace a newer Scene", async () => {
  // Use a real deferred promise loader and the store revision action.
  // Resolve the old response after selectScene("new-scene").
  expect(useWorkbenchStore.getState().appliedDerivation?.scene_id).toBe("new-scene");
});
```

- [ ] **Step 2: Run focused web tests and confirm missing module failures.**

Run: `npm test -- --run tests/web/pointcloud-protocol.test.ts tests/web/pointcloud-state.test.ts tests/web/pointcloud-viewer.test.tsx`

Expected: FAIL because Three.js, parser, viewer, and state actions do not exist.

- [ ] **Step 3: Install Three.js and implement strict binary parsing/stable LOD.**

Validate magic, header length, UTF-8 JSON, array descriptors, alignment, exact byte ranges, and supported
dtype/shape before constructing typed views. LOD chooses evenly spaced source indices and always includes the
first/last valid point when reducing; no random sampling.

- [ ] **Step 4: Implement Three.js scene lifecycle and state actions.**

Create/dispose renderer, scene, camera, controls, geometry, attributes and material. Map source coordinates with
`diag(1,-1,-1)` for display, retain original XYZ in pick results, and use `preserveDrawingBuffer` for PNG.
Increment request revision on Scene changes and ignore responses for older revisions.

- [ ] **Step 5: Run web unit tests and typecheck.**

Run: `npm test -- --run tests/web/pointcloud-protocol.test.ts tests/web/pointcloud-state.test.ts tests/web/pointcloud-viewer.test.tsx && npm run typecheck`

Expected: all focused tests pass and TypeScript strict mode reports no errors.

- [ ] **Step 6: Commit viewer foundation.**

```bash
git add package.json package-lock.json web/src tests/web
git commit -m "feat: add point cloud viewer foundation"
```

### Task 6: Processing controls, compare mode, measurement, and exports

**Files:**
- Create: `web/src/features/pointcloud/ProcessingPanel.tsx`
- Create: `web/src/features/pointcloud/MeasurementPanel.tsx`
- Create: `web/src/features/pointcloud/ExportActions.tsx`
- Modify: `web/src/features/inspect/SceneInspector.tsx`
- Modify: `web/src/app/App.tsx`, `web/src/app/app.css`
- Modify: `web/src/state/workbench.ts`, `web/src/api/client.ts`
- Create: `tests/web/pointcloud-workflow.test.tsx`

**Interfaces:**
- Processing controls edit only `draftProcessing`; Apply calls `createDerivation` and sets `appliedDerivation`.
- Measurement panel receives `selectedPoints` and renders `distance` with `m` or `unitless` based on the manifest.
- Export actions create PLY/JSON links from server URLs and PNG from `PointCloudSceneHandle.capturePng()`.
- Compare mode renders RGB, depth, point cloud, and statistics without duplicating geometry calculations.

- [ ] **Step 1: Write failing workflow tests.**

```typescript
it("keeps draft changes dirty until Apply and labels a unitless measurement", async () => {
  render(<PointCloudWorkflow scene={unitlessScene} />);
  await userEvent.click(screen.getByRole("button", {name: /应用处理/}));
  expect(screen.getByText("unitless")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", {name: /清除选点/}));
  expect(screen.queryByText(/距离/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the workflow test and observe missing controls/labels.**

Run: `npm test -- --run tests/web/pointcloud-workflow.test.tsx`

Expected: FAIL because the controls and workflow are not rendered.

- [ ] **Step 3: Implement ProcessingPanel and revision-safe apply flow.**

Expose ROI, stride, depth min/max, XYZ bounds, voxel size, max points, optional KNN controls with numeric
inputs/toggles. Show `dirty` and `cached` states; disable Apply while busy; abort an obsolete request when
switching scenes.

- [ ] **Step 4: Implement measurement and export actions.**

Render two selected points, XYZ values, distance and unit. Disable metric-only copy/convert controls for
unitless results. Use familiar Lucide icons with tooltips; PNG capture must use the current applied canvas.

- [ ] **Step 5: Integrate inspect/compare layouts and responsive styling.**

Keep M1 import wizard intact, add the viewer only after a derivation exists, and make compare mode a fixed
two-by-two grid that collapses to one column below the existing mobile breakpoint. Keep trajectory visible as a
clearly disabled M3 mode.

- [ ] **Step 6: Run focused web tests and production build.**

Run: `npm test -- --run tests/web/pointcloud-workflow.test.tsx tests/web/workbench-state.test.ts tests/web/import-wizard.test.tsx && npm run typecheck && npm run build`

Expected: focused tests pass, typecheck is clean, and Vite produces a production bundle.

- [ ] **Step 7: Commit the M2 workflow UI.**

```bash
git add web/src tests/web/pointcloud-workflow.test.tsx
git commit -m "feat: add point cloud analysis workflow"
```

### Task 7: End-to-end acceptance, documentation, and full verification

**Files:**
- Modify: `tests/e2e/m2-pointcloud.spec.ts`
- Modify: `tests/e2e/m1-import.spec.ts` if shared fixtures/helpers need extraction
- Modify: `README.md`, `docs/development.md`, `fixtures/m1/README.md`
- Create: `fixtures/m2/metric-depth.npy`, `fixtures/m2/metric-manifest.json`, `fixtures/m2/rgb.png`

**Interfaces:**
- Playwright starts the local service, imports a metric fixture, applies default ProcessingSpec, and verifies
  point cloud canvas, two-point measurement, PLY/JSON/PNG downloads, unit labels, and mobile no-overlap.
- The relative fixture proves the same flow stays `unitless` and does not expose meter controls.

- [ ] **Step 1: Write the failing browser acceptance test.**

```typescript
test("applies a metric derivation and exports all static artifacts", async ({ page }) => {
  await page.goto("/app");
  await importFixturePair(page, metricFixture);
  await page.getByRole("button", { name: /应用处理/ }).click();
  await expect(page.getByTestId("pointcloud-canvas")).toBeVisible();
  await expect(page.getByText(/距离.*m/)).toBeVisible();
  await expect(page.getByRole("link", { name: /下载 PLY/ })).toHaveAttribute("href", /derivations/);
});
```

- [ ] **Step 2: Run the new e2e test and confirm it fails before the fixtures/flow exist.**

Run: `npm run test:e2e -- tests/e2e/m2-pointcloud.spec.ts`

Expected: FAIL at the missing M2 control or canvas assertion.

- [ ] **Step 3: Add compact metric and relative fixtures and complete the browser flow.**

Keep fixture dimensions at 4x4 or smaller, use explicit manifests, and assert downloaded JSON contains scene
hash, processing spec, representation, and unit without an absolute path. Use Playwright download assertions
for PLY/JSON and `toDataURL`/download for PNG.

- [ ] **Step 4: Update user-facing documentation.**

Document M2 derivation/apply semantics, cache identity, point-cloud protocol boundary, measurement units,
static exports, and the continued M3 limitation. Do not add machine-specific paths or claim video support.

- [ ] **Step 5: Run the complete verification matrix.**

Run:

```bash
./.venv/bin/python -m pytest -q
./.venv/bin/ruff check src tests scripts
./.venv/bin/ruff format --check src tests scripts
./.venv/bin/mypy src/rgbd_workbench
npm test -- --run
npm run typecheck
npm run build
npm run test:e2e -- tests/e2e/m1-import.spec.ts tests/e2e/m2-pointcloud.spec.ts
```

Expected: all commands exit 0; any environment-only browser or encoder limitation is recorded with the exact
command and output rather than silently omitted.

- [ ] **Step 6: Commit the acceptance and documentation changes.**

```bash
git add README.md docs/development.md fixtures tests/e2e
git commit -m "test: verify m2 point cloud workflow"
```

## Completion Criteria

- A valid metric or relative Scene can produce an applied derivation without changing source files.
- Repeating the same request reuses a byte-identical cache; changing source identity or ProcessingSpec changes
  the key and invalidates old data.
- The viewer renders a non-empty, deterministic point cloud and disposes its resources when replaced.
- Two selected points show a correct distance with an explicit `m` or `unitless` label.
- PLY and JSON downloads reference the applied derivation; PNG captures the current viewer.
- Existing M1 tests remain green and no API payload leaks an absolute path.
