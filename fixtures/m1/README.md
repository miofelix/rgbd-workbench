# M1 Fixtures

The M1 test suite creates small deterministic fixtures in memory so the repository does not need to
carry binary image payloads. The three acceptance inputs are:

- 16-bit PNG values declared as millimeters in the import metadata;
- float32 NPY values declared as meters in the import metadata;
- float32 PFM values declared as `relative_z` / `unitless` without camera intrinsics.

All three are exercised by `tests/python/test_m1_integration.py` and the browser flow in
`tests/e2e/m1-import.spec.ts`.
