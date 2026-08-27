# BL-782 — cleaner pass — 20260825 (updated 20260826 rematch)

- merge_and_process coder tip `7c29920e10` (first pass); rematch tip `51919acd64`
  (QA bounce D1: module-scoped decoy reap + unref + afterEach).
- DRY: `spawnNeighbourDecoys` helper in `bl782ExpediteLivenessScopeSteps.js`.
- Verification (first pass):
  - `test_expedite_cli.sh`: ALL PASS
  - `test_lifecycle_script_scope.sh`: 15/15
  - `bl782LivenessProbesScopedToRoot.property.test.js`: 2/2

By cleaner.
