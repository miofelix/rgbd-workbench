# M1 Fixtures

The M1 test suite creates small deterministic fixtures in memory so the repository does not need to
carry binary image payloads. The three acceptance inputs are:

- 16-bit PNG values declared as millimeters in the import metadata;
- float32 NPY values declared as meters in the import metadata;
- float32 PFM values declared as `relative_z` / `unitless` without camera intrinsics.

All three are exercised by `tests/python/test_m1_integration.py` and the browser flow in
`tests/e2e/m1-import.spec.ts`.

M2 acceptance inputs are generated in `tests/e2e/m2-pointcloud.spec.ts` to keep the repository free of
opaque binary blobs. The metric and relative pairs use the same explicit pinhole/alignment metadata and
exercise the applied ProcessingSpec, Three.js viewer, unit-aware measurement, static exports and mobile
layout. Re-running an identical ProcessingSpec must reuse the same derivation key and bytes.
