# BL-1204 cleaner re-verification (Background fixture leak re-fix) — 2026-08-28

Merged coder's re-fix (`492886b8a0`) for the architect's D1 bounce (5th
BL-971-shape occurrence this session): the feature's `Background` step
unconditionally created a fixture root even for the scenario that never
uses one ("The help message lists exactly the redeploy targets"), leaking
it on every passing run of that scenario.

## Review
Fix moves `mkFixtureRoot()` out of the Background (now a no-op placeholder,
kept only so the shared Gherkin step text still matches every scenario)
into the one step that actually needs it (`the operator sends "/redeploy
X"`). Minimal, well-targeted, matches the ticket's own diagnosis exactly.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `run_acceptance.sh` on the feature: 4/4 pass, 3 consecutive runs.
- `ls /tmp | grep bl1204-acceptance`: 0 before and after every run — leak
  confirmed fixed for BOTH scenarios (not just re-verifying the one that
  was already covered).

By cleaner.
