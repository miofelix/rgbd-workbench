# Development Notes

## Boundaries

The Python service owns source probing, explicit normalization metadata, workspace transactions,
diagnostics, point-cloud processing and API responses. The browser owns interaction state, Three.js
view state and previews; it never recomputes geometry for exports. M1/M2 do not import device, model,
CUDA, robot or external-repository code.

The public domain contracts live in `src/rgbd_workbench/domain/`. JSON schemas in `schemas/` are generated
from those Pydantic models:

```bash
.venv/bin/python scripts/check-generated-schemas.py --write
.venv/bin/python scripts/check-generated-schemas.py
```

Do not hand-edit generated schema files.

## Test matrix

```bash
.venv/bin/python -m pytest -q
.venv/bin/ruff check src tests scripts
.venv/bin/ruff format --check src tests scripts
.venv/bin/mypy src/rgbd_workbench
npm test -- --run
npm run typecheck
npm run build
npm run test:e2e -- tests/e2e/m1-import.spec.ts tests/e2e/m2-pointcloud.spec.ts
```

`tests/python/test_m1_integration.py` covers metric float32 NPY and unitless PFM flows. The browser
test covers a PNG + PFM import, explicit `relative_z/unitless` confirmation, Scene commit and mobile
layout. `tests/python/test_derivation_api.py` covers idempotent derivation, stale-source invalidation,
binary/PLY/JSON downloads and unitless labeling. `tests/e2e/m2-pointcloud.spec.ts` covers metric and
relative applied derivations, WebGL canvas loading, point measurement, static downloads and mobile
overflow. The test web server uses a deterministic session token only inside the test process; normal
CLI sessions use a random token.

## Adding a format

Add a focused adapter under `src/rgbd_workbench/adapters/`, return a `ProbeCandidate`, and keep probing
separate from semantic normalization. Add fixtures for malformed headers, oversized declarations,
invalid dtype and missing units. Never infer units from numeric ranges or extension names.

## M2/M3 handoff

M2 consumes `SceneManifestV1`, `ProcessingSpecV1` and the staged source contract without changing their
meaning. `POST /api/v1/scenes/{scene_id}/derivations` is synchronous and cache-backed; its result is the
only source for the browser viewer, measurements, PLY and JSON exports. M3 should consume an applied
derivation and introduce the versioned CameraPath/RenderSpec contracts, CPU renderer, jobs/SSE and video
encoders. Do not add trajectory or video behavior to the M1 import endpoint as an implicit side effect.
