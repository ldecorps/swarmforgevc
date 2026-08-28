# BL-1204 cleaner re-verification (D1 re-fix) — 2026-08-28

Merged coder's re-fix (`ceb3111d29`) for the D1 bounce I raised
(`backlog/evidence/BL-1204-missing-acceptance-step-handler-bounce-20260828.md`):
the synchronous marker read raced the detached/unref'd redeploy spawn.

## Review
Fix replaces the synchronous `fs.readFileSync` with a bounded poll
(`waitForMarker`: 25ms interval, 3s timeout) before the assertion — never
unbounded, so a genuinely broken dispatch still fails fast. Cleanup
(`fs.rmSync(st.root, ...)`) untouched. No duplication or structural
issues.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `run_acceptance.sh` on the feature: 4/4 pass, run 3 times consecutively
  (matches the flake class this fixes — a single pass wouldn't have caught
  the original race either). No leaked `/tmp/bl1204-acceptance-*` fixture
  dirs after any run.

By cleaner.
