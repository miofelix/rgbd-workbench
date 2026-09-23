# RGB-D Lab

`rgbd-workbench` is a local, analysis-first RGB-D workbench for inspecting one RGB/depth pair,
confirming its geometry contract, and preparing later point-cloud and camera-path workflows. It is a
standalone project: it does not require a camera SDK, CUDA, model weights, robot software, or another
repository.

## What M1 provides

- Local browser service bound to `127.0.0.1`.
- Managed browser imports that copy source files into a workspace without modifying the originals.
- CLI Linked imports for large files, with source identity revalidation.
- PNG, JPEG, WebP and TIFF RGB probes.
- Single-channel PNG/TIFF, NPY, NPZ, PFM and manifest-described RAW/BIN depth probes.
- Explicit depth semantics for metric `z_depth` and `relative_z` unitless data.
- RGB/depth dimensions, dtype, invalid values, unit and alignment diagnostics.
- RGB and depth previews, depth summary, capability gates and a responsive analysis-first shell.

Point-cloud processing, Three.js geometry, trajectory editing and video rendering are intentionally
marked as M2/M3 capabilities in this first milestone.

## Install

Python 3.11+ and Node.js 24 LTS are supported on macOS and Linux.

```bash
uv sync --extra dev
npm ci
```

The equivalent Python setup is `python -m pip install -e '.[dev]'`.

## Run

Start the local service with a temporary or explicit workspace:

```bash
rgbd-workbench serve --workspace-root ./workspace
```

The command prints a one-time URL containing a session token and opens the browser unless
`--no-open` is supplied. The token is exchanged for an HttpOnly, SameSite cookie; business API routes
do not accept unauthenticated requests.

For a CLI-driven import:

```bash
rgbd-workbench open \
  --rgb ./data/rgb.png \
  --depth ./data/depth.npy \
  --workspace-root ./workspace
```

Use `--link` to retain a private reference instead of copying the source. Linked files are checked for
existence, identity and SHA-256 changes before use. The browser never accepts an arbitrary local path.

Check the local runtime without decoding image contents:

```bash
rgbd-workbench doctor --json
```

## Depth manifest contract

The file extension only selects a decoder. It never selects units. A manifest or the import wizard must
declare one of:

- `z_depth` with `m`, `mm`, or an explicit `scale_to_meter`;
- `relative_z` with `unitless`.

Missing semantics leave two-dimensional inspection available but disable geometry-dependent actions.
Metric point-cloud capability additionally requires equal RGB/depth dimensions, registered-to-RGB
alignment, pinhole intrinsics, and an undistorted input. The application never guesses these values.

## Workspace safety

Source files and published exports are read-only from the application's perspective. Imports stage and
hash data before an atomic Scene commit. API responses use opaque IDs and redacted summaries; absolute
paths are not returned. Derived outputs can be rebuilt from the Scene hash and applied parameters.

## Development

See [`docs/development.md`](docs/development.md) for the M1 test matrix, schema workflow and project
boundaries. The complete local check is:

```bash
bash scripts/run-m1-checks.sh
```
