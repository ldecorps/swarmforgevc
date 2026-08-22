# BL-762 — coder pass

Received `merge_and_process specifier 0e3f4b9c3b` (specifier's withdrawal of
the vetoed scheduled-day-shift-end half, already an ancestor of this branch
after merge). Implemented the bedtime verb: a distinct `./finish-shift`
lifecycle command that stops the token-burning ancillaries and the full
pipeline while leaving the phone path (Telegram front desk + remote
tunnels) reachable, per the ticket's keep-vs-kill matrix.

## What was built

- **`swarmforge/scripts/lifecycle_matrix.sh`** (new): the single explicit
  keep-vs-kill table both verbs read — `lifecycle_matrix_disposition`,
  `_stop_set`, `_keep_set`, `_validate` (loud failure on any unclassified
  component x verb cell — the ticket's first declared invariant). Plain
  indexed arrays, no `declare -A`: this project targets stock macOS
  `/bin/bash` 3.2, which predates associative arrays.
- **`swarmforge/scripts/stop_ancillary_services.sh`** (refactored): each
  component's stop logic is now its own function (`stop_babysitterd`,
  `stop_front_desk`, `stop_onboarder`, `stop_operator_runtime`,
  `stop_tunnels`) plus a `stop_ancillary_component` name dispatcher and a
  `stop_ancillary_services_main` that iterates `lifecycle_matrix_stop_set
  stop-swarm`. Run directly, byte-for-byte identical behavior to before
  this ticket (same log lines, same order — proven via the existing
  `test_stop_ancillary_services_onboarder_dual_clear.sh` and a fresh
  end-to-end run below). This is the "compose, don't fork" contract:
  finish-shift sources this file and calls only its stop-set's functions.
- **`swarmforge/scripts/finish_shift_lib.sh`** (new): the bedtime verb's
  library. `finish_shift_stop_ancillaries` (matrix-driven dispatch),
  `finish_shift_keep_snapshot` / `finish_shift_verify` (BL-637-style
  verification extended to bedtime's own contract — refuses success while a
  stop-set component still shows a live process, OR a keep-set component
  that WAS running before the run is no longer running after; a component
  that was already down before is not bedtime's problem to force up —
  BL-762's idempotent-05 scenario). `SWARMFORGE_SURVIVOR_PS_FILE` reuses
  `stack_survivor_scan.sh`'s own test seam.
- **`./finish-shift`** (new, repo root, executable): the CLI entrypoint,
  mirroring `./stop-swarm.sh`'s shape (usage, `--help`, REFUSE-on-problem
  posture).
- **`docs/how-to/BL-762-finish-shift-bedtime-vs-lights-out.md`** (new): the
  ticket's required short how-to.

## Scope items resolved as already-done

The ticket's notes call out "the misleading always-on comment at the head
of `stop_ancillary_services.sh`" ("the Cursor Remote bridge is
intentionally NOT stopped here"). Grepped the current file and the whole
`swarmforge/scripts/` tree for that phrase — it is not present; a prior
parcel already removed it. Nothing to fix here.

## Two real bugs found and fixed during authoring (not scope creep — both
##  block this ticket's own correctness)

1. **`lifecycle_matrix_stop_set`/`_keep_set`'s own exit status was
   accidentally meaningful.** Each function's last statement was a bare
   `[[ ... ]] && echo "$component"` inside a loop — under `set -e`/pipefail,
   the FUNCTION's own return code became whatever that last loop
   iteration's condition evaluated to (false/1 whenever the last classified
   component is "keep" for that verb — true today for "tunnels" under
   "finish-shift"). Any caller capturing the function's output via `$(...)`
   under `set -euo pipefail` (my own `test_finish_shift_lib.sh`) silently
   aborted despite the function producing exactly the right stdout. Fixed
   with an explicit `return 0` at the end of both functions.
2. **`stop_ancillary_services.sh` leaked `set -euo pipefail` into every
   sourcing caller.** The file is now dual-purpose (sourced library + a
   standalone script), but kept its unconditional top-of-file `set -euo
   pipefail` from before this ticket — bash options set via `source`
   persist in the CALLING shell. `finish_shift_lib.sh` sources it, so
   `errexit` silently became active in every script that sources
   `finish_shift_lib.sh` too, including bare (non-if-wrapped) statements
   never written expecting it. Moved `set -euo pipefail` into the
   run-directly guard at the bottom (only fires when the file is executed,
   never when sourced) — confirmed via direct repro (sourcing the file
   alone used to leave `errexit on` in the caller; now `errexit off`, and a
   bare `false` no longer aborts the caller).

Both are documented with their exact repro/fix in the source comments
(`lifecycle_matrix.sh`'s `lifecycle_matrix_stop_set`, and
`stop_ancillary_services.sh`'s file-header comment).

## A third bug, found in the Gherkin step handler itself (not production code)

The Then step shared by scenario 01 ("`<component>` is `stopped`/`left
running`") is ALSO scenario 04's third step, mid-scenario (not last). My
first draft unconditionally cleaned up the fixture in that handler's
`finally`, which — when reached mid-scenario-04 via "the Telegram front
desk is stopped" — deleted the mock `SWARMFORGE_SURVIVOR_PS_FILE` before
scenario 04's own later survivor-scan step ran, silently falling back to
this machine's REAL process table and reporting the real live swarm's real
babysitterd as a false-positive survivor. Fixed: "the operator has already
run finish-shift" (scenario 04's Given) sets
`ctx.bl762SkipComponentCleanup`, and the shared handler's `finally` checks
it before cleaning up — scenario 04's own actual last step ("the survivor
scan reports a clean slate") does the cleanup instead. Root-caused via a
sequence of isolated single-scenario probes outside the slow full
generate+run pipeline (see the git history of this file's authoring
session for the debugging trail); confirmed fixed by re-running the
isolated scenario and the full suite.

A related, purely mechanical bug also found and fixed along the way:
`startFixture`'s `sleep 300 &` fixture processes did not redirect their own
stdin/stdout/stderr, so they inherited `spawnSync`'s pipe file descriptors
— since `sleep` never exits, that pipe never reached EOF, and `spawnSync`
blocked until its own timeout fired even though the spawning `bash -c`
process had already returned. Fixed with `</dev/null >/dev/null 2>&1` on
each backgrounded `sleep`.

## Tests

- `swarmforge/scripts/test/test_finish_shift_lib.sh` (new): 11 checks —
  matrix stop/keep sets match the ticket's table; EXHAUSTIVE coverage of
  invariant 1 (all 10 component x verb cells individually removed, each a
  correctly-attributed loud failure — see BL-654 note below); invariant 2
  (finish-shift's keep-set has empty intersection with
  `LIFECYCLE_SEAT_REVIVING_COMPONENTS`); real stop behavior against fake
  `sleep 300` fixtures + real pidfiles; verify clean/idempotent (already
  bedtime-stopped, and fully-already-stopped) paths; a kept component dying
  unexpectedly is caught. All pass. Non-vacuity proven by flipping
  front-desk's finish-shift classification to "stop" — 01a/01b/04/08
  failed as expected; restored, all green.
- `specs/features/BL-762-finish-shift-leaves-the-phone-path-up.feature` via
  `run_acceptance.sh`: all 14 scenarios pass (9 from the keep-kill-matrix
  outline + phone-path-survives + no-relaunch + lights-out-still-works +
  2 from the idempotent outline). Driven by new
  `specs/pipeline/steps/bl762FinishShiftPhonePathSteps.js` against real
  scratch fixtures (matching this repo's established shell-test
  convention), never stubbed-out fakes.
- `test_stop_ancillary_services_onboarder_dual_clear.sh` (pre-existing):
  the repo's `timeout`/`gtimeout` binary is absent in this dev environment
  (pre-existing gap, confirmed via `git stash` — fails identically on the
  unmodified tree), so ran its exact assertions by hand without the
  wrapper — all pass, confirming the `stop_ancillary_services.sh` refactor
  is byte-for-byte behavior-preserving.
- `./stop-swarm.sh` end-to-end against a scratch fixture (all 5 fake
  ancillary processes + pidfiles): all 5 correctly stopped. (Its own exit
  code is non-zero in this dev environment because `kill_pipeline_swarm.sh`
  — unmodified, out of this ticket's scope — runs its own unrelated,
  unscoped survivor check and legitimately finds THIS machine's real live
  swarm's real `handoffd`; not a regression from this parcel.)

## BL-654 declared-invariant coverage

Ticket declares two invariants:

1. *"Every component the stack can stop is classified by each lifecycle
   verb explicitly; a component that is neither in the stop set nor the
   keep set of a verb is an error, never a default."* — **Exhaustive test
   authored, not a generated property test.** The (component, verb) domain
   is small and finite (5 x 2 = 10 cells); `test_finish_shift_lib.sh`'s
   check 02b removes each of the 10 cells in turn and asserts a correctly-
   attributed loud failure for each — full, deterministic coverage of the
   domain, strictly stronger than a sampled/generated property would be for
   a domain this size. No property-test framework is wired for plain bash
   in this repo (Startup Tools names only TypeScript/Babashka/APS as
   covered gates); an exhaustive enumeration is the appropriate executable
   encoding here, not a stated-reason exemption.
2. *"Bedtime never leaves running anything that can revive a stopped
   seat."* — **Executable test authored** (check 03): asserts
   `lifecycle_matrix_keep_set finish-shift`'s output has empty intersection
   with `LIFECYCLE_SEAT_REVIVING_COMPONENTS` (`babysitterd` today, the only
   component that respawns agent seats). Both non-vacuity-proven together
   via the front-desk classification flip described above.

## Handoff

`git_handoff` to `cleaner`, priority `50`, task `BL-762`.
