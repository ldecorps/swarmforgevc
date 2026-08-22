# BL-877 — architect pass — 2026-08-11

## Scope reviewed

Parcel received from cleaner as its own `git_handoff`
(`BL-877-portable-process-liveness-without-proc`, commit `79db75ce47`,
correctly split from the BL-871 handoff per Article 2.6 — two tickets,
two forwards). Same commit as BL-871's own parcel (both point at the same
merge); already merged into this branch reviewing BL-871.

Files touched by this task: `swarmforge/scripts/proc_fd_scan_lib.bb`
(the shared primitive, extended), `swarmforge/scripts/operator_runtime.bb`
(sandbox-sweep consumer), `swarmforge/scripts/fixture_reaper_sweep_lib.bb`
(reaper consumer), `swarmforge/scripts/test/proc_fd_scan_lib_test_runner.bb`
(new), `swarmforge/scripts/test/test_operator_runtime_sandbox_sweep_liveness_undetermined.sh`
(new), `specs/features/BL-877-portable-process-liveness-without-proc.feature`
(promoted from `.draft`, unchanged Gherkin), `specs/pipeline/steps/bl877PortableProcessLivenessSteps.js`
(new) + `specs/pipeline/steps/index.js` (registration).

Also present in the same merge commit but **not** this task's scope:
`swarmforge/scripts/orphan_janitor_lib.bb`,
`orphan_janitor_sweep_lib.bb`, `process_table_lib.bb`'s
`parent-orphaned?`, and `backlog/INTAKE-parent-orphaned-front-desk-janitor-stamp.md`
— traced to commit `36ea0109e9` ("Land parent-orphaned front-desk janitor
fix and file swarm stamp-off intake"), already tracked in
`backlog/hotfix-ledger.yaml` (`state: pending`, awaiting a retroactive
stamp ticket) and landed on `main` independently of this parcel. Ordinary
hot-sync baggage from the coder's own `git merge remote-tracking branch
'origin/main'`, not something coder/cleaner authored as BL-877 scope
creep. Not reviewed here.

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js` against the one JS file
this task touches (`specs/pipeline/steps/bl877PortableProcessLivenessSteps.js`
— the `.bb` files are outside dependency-cruiser's TS/JS graph):
**PASSED, no forbidden edges.**

## Co-change coupling (BL-255)

`node extension/out/tools/co-change-report.js` against
`proc_fd_scan_lib.bb`, `operator_runtime.bb`, `fixture_reaper_sweep_lib.bb`,
and the new step file. `operator_runtime.bb` reports dozens of
high-frequency "SUSPECTED COUPLING" entries — a pre-existing central hub
file touched by nearly every ticket in this area (same pattern already
noted as benign in my prior BL-871 pass for `specs/pipeline/steps/index.js`).
`proc_fd_scan_lib.bb`'s own coupling is exactly its two real consumers
plus this task's own test/evidence/spec files — the coherent slice one
ticket should produce. No coupling defect found.

## required_wiring (BL-874 lesson applied)

Checked as a literal substring in each named file, in the SENDER's
checkout (this merged worktree, not a remembered summary):

- `swarmforge/scripts/operator_runtime.bb::proc-fd-scan-lib` — present
  (line 767: `(proc-fd-scan-lib/live-pid-paths!)`).
- `swarmforge/scripts/fixture_reaper_sweep_lib.bb::proc-fd-scan-lib` —
  present (line 108: `(proc-fd-scan-lib/live-pid-paths!)`).

Both consumers call the ONE shared entry point; neither retains its own
`/proc` listing loop (confirmed by reading both diffs in full — the old
inline `fs/list-dir "/proc"` calls are deleted, not left dormant
alongside the new call).

## Invariants review (BL-654)

Babashka/shell has no property-test framework wired (engineering.prompt's
Testability Boundary gap, same class documented for Bubble/Android) — the
ticket's own three invariants are verified via real executable
tests/acceptance rather than a `*.property.test.js`, per the coder role's
own instruction for this stack. Independently re-ran every one of them on
this host rather than trusting the writeup:

1. *"Liveness is never silently assumed absent."* Ran
   `test_operator_runtime_sandbox_sweep_liveness_undetermined.sh` directly
   — 3/3 checks pass, confirming the fail-safe-keep default and the log
   line. Read the nil-propagation path end to end:
   `proc-fd-scan-lib/live-pid-paths!` → `live-process-paths!` →
   `sandbox-sweep!`'s 0-arity default flips `:live-process-rooted-in?` to
   unconditional `true` only when `paths` is `nil`, never on a real `#{}`.
2. *"Same keep/kill verdict on macOS as on Linux."* Ran
   `proc_fd_scan_lib_test_runner.bb` directly — all pure-parser assertions
   pass, including the txt/mem-exclusion and non-absolute-path-drop cases
   that specifically pin lsof/procfs output-shape parity. Ran the full
   BL-877 acceptance suite — scenarios 5 and 6 ("the same rooted process
   yields the same verdict on either userland", BSD and GNU rows) both
   pass, exercising the real lsof branch and a synthetic-`/proc` procfs
   branch against the identical live child process.
3. *"One shared primitive, no re-implementation."* Structural — confirmed
   directly above under required_wiring by reading the diff, not
   inferring from the ticket text.

Non-vacuity: didn't just read the coder's break-then-fix claims, ran the
tests myself and read the assertions' own construction (e.g. the
txt/mem-exclusion case asserts an EMPTY result for a mem-only fd, not a
weaker "doesn't crash" check — a real filter regression would fail it).

## Correctness spot-check

Traced `pids-rooted-in`'s `nil` handling by hand (not just read the
comment): `(filter (fn [[_ paths]] ...) pid->paths)` with `pid->paths =
nil` — Clojure's `filter` treats `nil` as an empty seq, so this returns
`()`, exactly the "no pids to kill" behavior the comment claims. No
NullPointerException risk, no defect.

## Independent verification (not just re-reading the coder's evidence)

Ran directly on this host, not taken on the writeup's word:

- `bb swarmforge/scripts/test/proc_fd_scan_lib_test_runner.bb` — ALL
  CHECKS PASSED.
- `bash swarmforge/scripts/test/test_operator_runtime_sandbox_sweep.sh` —
  6/6 ok, including the two liveness-dependent checks ("a stale
  known-prefix sandbox with a live process rooted in it is kept", "...an
  OPEN FILE inside it (cwd elsewhere) is kept") — the exact two that were
  red before this fix per the ticket's own description.
- `bash swarmforge/scripts/test/test_operator_runtime_fixture_reaper_sweep.sh`
  — 9/9 ok.
- `bash swarmforge/scripts/test/test_operator_runtime_fixture_reaper_sweep_bounded_progress.sh`
  — all ok, including "the remaining orphaned process is killed too".
- `bash swarmforge/scripts/test/test_operator_runtime_sandbox_sweep_liveness_undetermined.sh`
  — 3/3 ok.
- `specs/pipeline/scripts/run_acceptance.sh` for this ticket's feature —
  **7/7 scenarios pass**, 22.1s total.

All five named/new test scripts and the full acceptance suite are green
on this exact macOS host (no `/proc`, real `lsof` present) — the
condition the ticket exists to fix.

## Property testing pass

No new/changed pure JS module in this task's scope — the one JS file
touched (`bl877PortableProcessLivenessSteps.js`) is I/O-driving
acceptance test infrastructure (spawns real `operator_runtime.bb`
subprocesses), not a pure decision function. No property test added; not
manufacturing a vacuous one.

## Verdict

Clean. No architecture violation, no invariant violation, no correctness
defect found. Forwarding to hardener.

By architect.
