# BL-1202 cleaner pass — 2026-08-28

Merged coder handoff `c6705b4449` for BL-1202 (property-suite guard reports
its BL-1124 shared-repo canary on every exit path, including a mid-run
kill — the exact hazard behind this session's own "Property suite full run
HIJACKS role branch refs" operator note). Clean merge, no conflicts.

## Review
`report_canary_once()` is idempotent (guards against double-reporting from
both the normal path and the EXIT/INT/TERM traps), bounded (a
grace-then-force kill loop, never an indefinite wait on a dying child),
and correctly scoped (BEFORE/SUITE_PID only set once a real suite run
starts, so every short-circuit path stays a no-op). Runs the suite as
leader of its own process group so a kill can take the whole group down by
pgid — the actual fix for orphaned suite processes. No duplication or
structural issues; minor: `SUITE_OUT_FILE` (mktemp) isn't cleaned up on an
abnormal exit before its own `rm -f`, but that's a single stray temp file,
unrelated to this ticket's shared-repo-canary scope — not worth a finding.

## Verification
- `test_property_suite_drift_guard.sh`: all 15 scenarios pass, including
  the two new kill-mid-run scenarios (14/15).
- Acceptance (`BL-1202-shared-repo-canary-reports-on-every-exit-path.feature`
  via `run_acceptance.sh`): 4/4 pass.

By cleaner.
