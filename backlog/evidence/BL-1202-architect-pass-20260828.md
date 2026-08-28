# BL-1202 — architect pass, 2026-08-28

Commit reviewed: f8524fb3c1 (cleaner, verifying coder fix c6705b444).

## Architecture
Pure bash (`swarmforge/scripts/check_property_suite_drift.sh`); no
TypeScript touched, dependency gate N/A. Co-change shows the expected
sibling hook scripts (pre-commit, check_commit_size.sh, etc.) — none
require a change for this ticket's explicitly scoped single-file fix.

## required_wiring
`trap on_interrupt INT TERM` / `trap 'report_canary_once || true' EXIT`
confirmed present in `check_property_suite_drift.sh` itself (the guard
that actually runs), not only in the sourced
`property_suite_shared_repo_guard.sh` lib. Satisfied.

## Invariants (declared)
1. "The guard reports its shared-repo canary verdict on every path by which
   a started suite run ends, including paths the guard did not choose." —
   Encoded: shell-test scenarios 01-13 (green/red/skip paths, unchanged)
   plus new scenarios 14 ("killing the guard mid-run still reports the
   BL-1124 canary verdict") and the acceptance feature's 3-example outline
   (pass/fail/killed). **Independently re-verified non-vacuous**: checked
   out the pre-fix baseline commit (c6705b444^) in a throwaway worktree,
   copied over just the new test file, and confirmed scenario 14 genuinely
   FAILS there ("expected the canary to still be reported on a killed run,
   got: property-suite-guard: run") while every earlier scenario still
   passes — then confirmed 15/15 green on the actual fix.
2. "No process the guard started outlives the guard." — Encoded: scenario
   15, checking both the fake suite's direct child AND its own grandchild
   by PID/process-group liveness (not by name), matching
   qa_e2e_procedure step 3.

## Short-circuit constraints (unchanged behaviour)
Traced the control flow: `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1`, the
path-skip, and the BL-1121 reconcile-import skip all exit before `BEFORE`
is ever assigned, so the EXIT trap's `[[ -n "$BEFORE" ]] || return 0` makes
them true no-ops even though the trap is registered earlier in the script.
The exit-127 (toolchain-missing / command-not-found) path sets
`CANARY_DONE=1` directly and skips the kill-and-assert logic, which is
correct since a 127 from `wait` means the backgrounded job already exited
(nothing left to signal). Confirmed via shell-test scenario 05 (unchanged,
still green).

## Verification run
- `test_property_suite_drift_guard.sh`: 15/15 pass.
- `run_acceptance.sh` on the BL-1202 feature: 4/4 pass.

NONE outstanding. Forwarding to hardener.

By architect.
