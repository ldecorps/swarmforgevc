# BL-1570 — declared invariant: stated reason, not a property test (BL-654)

BL-654 requires that each declared invariant leave this parcel either as a
coder-authored executable property test or as a **stated reason** why it
admits no executable encoding — never silently unencoded.

- **Author**: coder, 2026-09-14.

## Invariant — "A test of a host-conditional branch constructs the condition
through a seam on every supported host (macOS and Linux); it never relies
on the host it was written on."

**Stated reason: it quantifies over test-authoring practice, not over a pure,
testable module.** The subject is *how a test is written* (does it construct
its case through a seam, or lean on an assumption about the host running
it), across the set of host-conditional branches in the shell test suite.
There is no generator space here — a property test needs states of a module
to draw from, and "the way a human phrased a test's setup" is not a runtime
value a generator can construct or a pure function can be asserted over.
Shell/Babashka also carry no property-test lane in this repo (Design And
Testability: "Babashka/Clojure … have NO mutation/CRAP/DRY wired").

**The concrete instance is already executable, at the correct altitude.**
The ticket is scoped to exactly two files, and the feature file's scenario
`the undetermined tick constructs the no-proc case through the seam`
(`specs/features/BL-1570-….feature` lines 22-31, backed by
`specs/pipeline/steps/bl1570LivenessUndeterminedProcDirSteps.js`) greps both
files' undetermined-tick `run_tick` call for a non-empty `SWARMFORGE_PROC_DIR`
argument and a non-empty `SWARMFORGE_LSOF_BIN` argument, and confirms neither
claimed-nonexistent path is ever `mkdir`'d in the file — i.e. it checks the
seam is present AND that the path it names truly doesn't exist, not merely
that some string literal is present. That is the invariant's real-world
instance, encoded and non-vacuous (verified failing when the seam was
removed, see below); generalizing it into a repo-wide property (e.g. "every
host-conditional shell test in this suite uses a seam") would be a different,
larger slice the ticket does not ask for and whose arrival colour on the rest
of the shell-test suite has never been measured — the same BL-997 trap noted
in BL-1006's equivalent stated-reason evidence.

## Non-vacuousness check performed

With the seam removed from the undetermined `run_tick` call in
`test_operator_runtime_sandbox_sweep_liveness_undetermined.sh` (4th argument
dropped), re-running
`bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1570-….feature`
produced `not ok` on both scenario-outline cases for that file (`# pass 3` /
`# fail 2`). Restoring the seam returned it to `5/5`. Same check performed
directly against the shell test itself (`bash test_operator_…undetermined.sh`
FAILs its two undetermined-tick assertions with the seam removed, passes
restored) — confirms both the acceptance step and the underlying fix are
live, not tautological.

## Full verification for this parcel

| check | result |
|---|---|
| `test_operator_runtime_fixture_reaper_sweep_liveness_undetermined.sh` ×3 | `ALL CHECKS PASSED`, exit 0, all 3 runs |
| `test_operator_runtime_sandbox_sweep_liveness_undetermined.sh` ×3 | `ALL CHECKS PASSED`, exit 0, all 3 runs |
| `test_operator_runtime_fixture_reaper_sweep.sh` (determined sibling) | `ALL CHECKS PASSED` — unaffected |
| `test_operator_runtime_sandbox_sweep.sh` (determined sibling) | `ALL CHECKS PASSED` — unaffected |
| `git diff main -- swarmforge/scripts/proc_fd_scan_lib.bb swarmforge/scripts/fixture_reaper_sweep_lib.bb swarmforge/scripts/sandbox_sweep_lib.bb` | empty |
| `node specs/pipeline/cli.js` equivalent (`run_acceptance.sh`) on `specs/features/BL-1570-….feature` | 5/5 |
| break-then-restore (seam removed, re-added) | fails on this Linux host without the seam, passes restored |
