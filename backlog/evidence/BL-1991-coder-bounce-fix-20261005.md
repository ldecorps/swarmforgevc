# BL-1991 coder evidence: bounce fix (2026-10-05)

Architect bounce (`backlog/evidence/BL-1991-architect-bounce-20261005.md`,
commit 7c8e9b576a): D1 CONFIRMED - the generated launch script runs under
`set -euo pipefail`, so a qwen process the repeat guard killed for a
restart (a non-zero/signalled exit) aborted the whole script before the
`pending_msgs` check ever ran - exactly the one case the feature exists to
handle.

## Fix

`swarmforge.sh`'s `local-model)` case: both qwen invocations (the initial
kickoff and the loop's own relaunch) now end `|| true`, so neither trips
`set -e`; the script always reaches the `pending_msgs` check regardless of
why or how qwen exited.

## Reproduction, before and after

Reran the architect's own repro shape (real case block extracted via the
same awk technique `test_bl1971_local_model_repeat_guard.sh` uses, a fake
`qwen` exiting 143, sourced under `set -euo pipefail`):

- Before the fix: the script died at exit 143 right after the first qwen
  call; the loop, "SCRIPT_FINISHED", and the pending `.msg` file's
  consumption never happened.
- After the fix: "SCRIPT_FINISHED" prints, the loop runs exactly once,
  relaunches qwen with the pending override text, and the `.msg` file is
  consumed.

## Regression test added

`swarmforge/scripts/test/test_bl1991_local_seat_restart_launch.sh`: runs
the REAL `local-model)` case block (never a restatement) under the real
template's own `set -euo pipefail`, against a fake qwen, covering:

1. non-zero exit (the guard's kill) + a pending override -> relaunches
   with it exactly once, survives `set -e`, consumes the file;
2. non-zero exit + nothing pending (an ordinary crash) -> script still
   completes, no loop;
3. a clean (0) exit + nothing pending -> same as (2).

Confirmed non-vacuous: with the `|| true`s removed, the test itself dies
at exit 143 (the exact architect-reported failure) instead of reporting a
clean FAIL - then restored and reran green.

## Everything the architect already checked

Unaffected by this fix (same files, same logic): both declared invariants
in `local_model_repeat_guard.bb`, the acceptance feature (4/4),
`test_bl1971_local_model_repeat_guard.sh` (regression, unaffected), and
the property test's dependency-gate cleanliness. Reran all after the fix;
all still hold.
