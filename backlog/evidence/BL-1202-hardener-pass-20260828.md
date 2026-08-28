# BL-1202 hardener pass — 2026-08-28

Merged architect handoff `7858fce2e5` (clean pass, canary-on-every-exit-path
independently re-verified non-vacuous against the pre-fix baseline). No
conflicts.

## Mutation cooldown gate (BL-149)

Pure bash, no `mutation_cooldown_gate.bb`-scoped TS file touched. This
ticket's own applicable gate is a hand-authored mutation sweep (no wired
tool for bash), per BL-638's fallback discipline.

## A real, non-vacuous gap found and closed: the standalone EXIT trap is load-bearing, and untested

The guard installs two trap mechanisms: `trap on_interrupt INT TERM` and
`trap 'report_canary_once || true' EXIT`. Hand-mutated by deleting the
`EXIT` trap line and re-ran both test suites:

- `test_property_suite_drift_guard.sh` (15 scenarios, pre-hardening): **all
  15 still passed.** Scenario 14 (the only kill-based scenario) sends
  `SIGTERM`, which `on_interrupt` catches directly and calls
  `report_canary_once` itself before `exit 1` — so the standalone EXIT
  trap is genuinely redundant for every path either test suite exercised.
- `run_acceptance.sh` on the BL-1202 feature: all 4 scenarios also still
  passed (same reason — the acceptance CLI's "killed" mode also sends
  SIGTERM).

**This is a real gap, not equivalence** — confirmed by direct experiment,
not by reasoning alone (2026-08-20 rule on trap-mutant equivalence: "verify
live before calling it a gap"). A 2-line bash script with only `trap ...
EXIT` (no HUP trap) run under `kill -HUP` DOES fire its EXIT trap (exit
status 129) — bash's documented behavior of still running the EXIT trap on
an untrapped fatal signal. The guard traps INT and TERM explicitly but
**not HUP**, so a HUP delivery to the guard — a plausible real shape for
"the foreground git commit was killed" (a closing terminal, or the parent
process group dying, both commonly send HUP rather than TERM) — relies
entirely on the standalone EXIT trap and nothing else. Deleting that line
leaves the guard silently un-reporting on exactly the class of kill this
ticket exists to catch, for one specific signal.

**Closed with a new test, not just a note**: added scenario 16 to
`test_property_suite_drift_guard.sh`, mirroring scenario 14/15's fixture
shape exactly but sending `SIGHUP` instead of `SIGTERM`. Verified
non-vacuous the same way architect verified scenario 14: removed the
`EXIT` trap line and confirmed **only** scenario 16 fails (`expected the
canary to still be reported on a HUP-killed run, got: property-suite-guard:
run`) while scenarios 1-15 stay green — proving this test, and only this
test, pins that line. Restored the fix and re-ran: 16/16 pass.

**Side effect of the same mutant, also caught by hand**: with the EXIT
trap removed, the HUP-killed run's `sleep 30` suite process was ALSO not
reaped (the process-group kill lives inside `report_canary_once`, which
never ran) — confirmed by finding the orphaned `sleep 30` process still
alive after the mutant run, reaped by hand. With the fix restored, no such
process survives.

## Verification

- `test_property_suite_drift_guard.sh`: 16/16 pass (was 15; +1 new).
- `run_acceptance.sh` on the BL-1202 feature, 3 consecutive runs: 4/4
  green each time.
- No orphaned processes after any run with the real (fixed) code
  (`ps aux | grep 'sleep 30'` clean).
- Standing whole-tree guards (unchanged from prior passes this session):
  same 4 pre-existing failures, none naming any BL-1202 file.

## Cleanup

Reaped the one orphaned `sleep 30` process created by my own deliberate
EXIT-trap-removal mutant (real code was restored immediately after each
probe; `git diff` on `check_property_suite_drift.sh` was empty before
moving on each time). No other scratch state left behind.

By hardener.
