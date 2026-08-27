# BL-595 — cleaner pass — 20260825

- Tip-pure rebuild from `origin/main` + coder `4c14e0364b` only
  (`dels_on_origin=0`).
- DRY: shared `pushBucketValue` / `meanSeries` for outcome and tick
  aggregators in `humanLoopReliability.ts`.
- `node --test extension/test/humanLoopReliability.test.js` — 6/6 pass
  (after `tsc`).

By cleaner.
