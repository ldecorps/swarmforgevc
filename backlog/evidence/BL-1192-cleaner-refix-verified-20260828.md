# BL-1192 cleaner re-verification (architect bounce D1/D2 re-fix) — 2026-08-28

Merged coder's re-fix (`39d237159e`) for the architect's D1/D2 bounce.
D1: rescoped the gate from the literal `origin/main...commit` range
(false-positive avalanche on real branch topology, batch roles
legitimately accumulating other already-forwarded tickets' commits before
origin/main catches up) to the union of each commit's own tree diff,
walked first-parent from the most recent recorded handoff for the exact
task, counting only commits tagged with this task's own ticket id — a
prior first-parent-only narrowing (mirroring BL-953) had under-reached.
D2: the acceptance fixture's "batch" mode now builds the real
multi-commit-drift shape instead of being structurally blind to it.

Also notable: coder's commit restores `swarm_handoff.bb`'s task-scope-gate
wiring itself, which was silently dropped by the merge that absorbed the
architect's bounce-revert (git accepted the revert's deletion since no
further edits touched that region) — confirmed present now (`grep
task-scope-gate swarm_handoff.bb` shows load-file, result/-block, and
refusal-message wiring intact).

My own earlier `BL-1192-cleaner-pass-20260828.md` evidence file was swept
up in the architect's revert of the whole flawed implementation chain —
expected, correct bounce-revert behavior, not a data-loss concern.

## Verification
- `task_scope_gate_lib_test_runner.bb`: ALL PASS.
- Acceptance (`BL-1192-pre-handoff-task-scope-gate.feature` via
  `run_acceptance.sh`): 8/8 pass (up from 7, new scenario for the batch
  multi-commit-drift shape).
- `test_property_suite_drift_guard.sh`: all 16 scenarios pass (regression
  check).
- 0 leaked `/tmp/bl1192-*` directories.

By cleaner.
