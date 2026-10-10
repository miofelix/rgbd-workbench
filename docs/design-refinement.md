# Workbench design refinement

The refinement covers the existing local workflow: import and confirm an RGB-D pair, inspect images,
apply point-cloud processing, compare and measure, export static artifacts, and preview a camera path.
Future video jobs and custom keyframe editing are not advertised as current actions.

## Stage 1 — workspace and navigation

- Use a light, two-column workspace with readable text, consistent controls and more space for data.
- Show the import wizard for a first or explicitly requested import; return to analysis after saving.
- Keep saved scenes accessible on both desktop and mobile, and preserve analysis when selecting the
  current scene again.
- Consolidate metadata into expandable data checks and collapse source previews after generating geometry.
- Keep image inspection available without geometry, and provide a working static export destination in
  each analysis mode.
- Show scene loading/failure states, retain successful results on request failure and isolate import diagnostics.

## Stage 2 — focused input and processing

- Group required semantics separately from geometry and additional depth settings.
- Show chosen files, allow manifest removal, retry probing and cancel an import.
- Keep four common processing fields visible; expose ROI, XYZ, voxel and KNN only when needed.
- Validate processing before applying; label normalized metric values in meters and relative values as
  unitless. Allow returning to applied settings or defaults.

## Stage 3 — recovery and acceptance

- Reopen saved scenes as independent import drafts to complete or correct metadata without modifying
  existing scenes or their source files.
- Retry failed point-cloud loads; enable screenshots and trajectory controls only when the viewer is ready.
- Confirm copy/export feedback and avoid selecting a measurement point after dragging the view.
- Bound browser trajectory sampling and ensure a newly loaded viewer receives its current pose.
- Verify metric and unitless import → analysis → measurement → download flows, metadata completion,
  error recovery, keyboard access, and layouts from 320px phones to desktop widths.

## Validation

Use the existing Python, TypeScript and browser acceptance suites plus focused interaction tests for new
state transitions. Inspect desktop and mobile screenshots in addition to overflow checks. Each stage is
committed separately using English Conventional Commit messages.
