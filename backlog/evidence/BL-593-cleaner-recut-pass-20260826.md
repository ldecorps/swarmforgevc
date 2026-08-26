# BL-593 — cleaner re-cut pass — 20260826

- merge_and_process QA bounce `e3e8f34792` (D1: tip entangled with BL-980
  `c15f9eee8`).
- Re-cut: cherry-picked coder tip `28ea08cab` onto cleaner branch — 12 paths,
  zero BL-980 files in commit delta (`9b7974573`).
- Verified: `mutationRunTelemetry.test.js`, `mutationRunTelemetryStore.test.js`,
  `mutationProgressReporter.test.js` — 21/21 PASS.

By cleaner.
