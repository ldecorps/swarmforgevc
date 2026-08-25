# BL-782 — cleaner pass — 20260825

- merge_and_process coder tip `7c29920e10` (resolved bl669 property test add/add conflict).
- DRY: `spawnNeighbourDecoys` helper in `bl782ExpediteLivenessScopeSteps.js`.
- Verification:
  - `test_expedite_cli.sh`: ALL PASS
  - `test_lifecycle_script_scope.sh`: 15/15
  - `bl782LivenessProbesScopedToRoot.property.test.js`: 2/2

By cleaner.
