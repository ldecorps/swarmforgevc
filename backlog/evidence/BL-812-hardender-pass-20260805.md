# BL-812 hardener review — clean pass, NONE

**Ticket:** BL-812 — handoffd's process cwd is not guaranteed to be its argv
project-root; every `target-root`-scoped read in `handoff_lib.bb` shelled
`git rev-parse --git-common-dir` from cwd, so under a foreign cwd the resident
looked absent, chase degraded to waking a session mono-router never creates,
and the swarm starved.
**Reviewed commit:** dfa664b337 (architect, merge_and_process into hardener).
**Role:** hardener.

## Inventory: NONE — every check run or explicitly noted, no defects found.

1. **Tooling scope (engineering.prompt Startup Tools).** Diff touches only
   `.bb` (`handoff_lib.bb`, `handoffd.bb`), test fixtures (`.bb`/`.sh`),
   `.js` step handlers, and spec/backlog/evidence files — zero `extension/src`
   or `extension/media` TypeScript. Stryker/jscpd/CRAP are TS-only and do not
   apply; `.bb` mutation/CRAP/DRY tooling is not wired (documented gap,
   BL-472). Gate is the `.bb` unit-test suite under
   `swarmforge/scripts/test/`, run below.

2. **Merge ancestry.** `git merge-base --is-ancestor dfa664b337 HEAD` holds —
   merged clean, no conflicts, nothing reset or replaced.

3. **Fix-completeness re-verification (independent of architect's pass).**
   Grepped `handoff_lib.bb` for every `(target-root)` call site (9 total:
   `bounce-drain-sentinel`, `load-role-info`/`load-all-roles` 0-arity forms,
   `roles-tsv-path`, `handoff-body-lead`, `tmux-socket`, `launch-script-path`,
   `mono-router-active-role-path`, `ambulance-lib/read-ambulance-state`) —
   all compose through the single fixed function. Grepped every `.bb` file
   under `swarmforge/scripts/` for `git-common-dir`/`rev-parse` shell-outs:
   `handoffd.bb`'s own three direct git calls (lines 1335, 1347, 2018) all
   pass `{:dir project-root}` explicitly, unaffected by cwd. `worktree-root`
   (handoff_lib.bb:35, no `:dir`) is the deliberately distinct per-worktree
   function the architect's pass already scoped out — confirmed still
   unused by any target-root-scoped read. No bypass site found.

4. **Call-site re-verification.** Grepped `handoffd.bb` for every
   `handoff-lib/wake-session`, `mono-router-resident-session`,
   `rotate-resident-to!`, `mono-router-home-role`,
   `read-mono-router-active-role` invocation (18 call sites across lines
   322–2375) — every one calls into handoff-lib, none shells git directly.

5. **Startup ordering.** `handoff-lib/set-project-root!` (handoffd.bb:98) runs
   immediately after `project-root` is parsed from argv (line 88-89) and
   before `state-dir`/`roles-file`/`socket-file` etc. are defined (line
   123+) or any handoff-lib call executes — no window where a target-root
   read could run before the override is set.

6. **State-leak check (batch/property-test hygiene).** `explicit-project-root`
   is a `defonce` atom, so it persists across `load-file` re-evaluation
   within one process — correct for the daemon's single long-lived process.
   Confirmed every test/fixture that exercises it does so via a fresh `bb`
   subprocess per case (`bl812_root_probe.bb` invoked once per scenario by
   `test_handoffd_bl812_cwd_invariant_root_resolution.sh`), so no
   cross-scenario state bleed; the property runner's P1-P3 sequence
   deliberately reuses one process and resets via `set-project-root! nil`
   at the end (P3), which re-ran clean.

7. **Independent re-run of every test the coder/architect listed**, all
   green in this worktree, at severe host load (uptime load avg ~150-166 on
   4 cores — ran anyway since these are lightweight `.bb`/subprocess
   scripts, not Stryker, and each completed in seconds):
   - `handoff_lib_test_runner.bb` — ALL TESTS PASSED
   - `handoff_wake_session_test_runner.bb` — ALL TESTS PASSED
   - `mono_router_lib_test_runner.bb` — ok
   - `bl812_project_root_override_property_runner.bb` — 500/500 runs, ALL
     PROPERTIES HOLD, generator coverage 498/500 distinct
   - `test_handoffd_bl812_cwd_invariant_root_resolution.sh` — all 9
     sub-scenarios (01a-01e, 02, 03, 04, 05) PASS
   - `specs/pipeline/scripts/run_acceptance.sh` on the BL-812 feature —
     9/9 pass
   - `test_chase_sweep.sh`, `test_rotate_to_role_stuck_parcel_gate.sh`,
     `test_corrupt_handoff_never_dispatched.sh`,
     `test_handoffd_ambulance_wiring.sh`,
     `test_handoffd_pause_suppresses_outbound_wakes.sh`,
     `test_ready_for_next_rotate_home.sh`, `test_sidecar_no_orphan.sh` —
     ALL PASS

8. **Acceptance step-handler audit** (`bl812HandoffdCwdWakeRemapSteps.js`):
   drives the real shell fixture once per scenario group via `spawnSync`,
   caches, and asserts on that specific scenario's `PASS: <marker>` line in
   its stdout — not a vacuous no-op registration. No step silently no-ops
   without checking the real fixture output.

9. **No orphaned processes.** `pgrep -fl 'node --test|stryker'` clean before
   and after this pass; all runs above terminated on their own.

10. **BL-638 non-interference.** This worktree's shared history also carries
    BL-638 commits (architect pass, gherkin-mutation source/tests) because
    that parcel shares the branch timeline, but BL-638's own hardener parcel
    is still under ambulance-hold (confirmed via `ready_for_next.sh`'s
    `SKIPPED ambulance-hold` lines for both a QA merge-up note and an
    architect handoff) — not delivered to this role in this batch. Nothing
    in this pass touches, forwards, or evaluates BL-638 files.

## Disposition

No hardening changes needed — the coder's property test (BL-654 invariant 1,
500 generated roots) plus the 9-scenario real-fixture acceptance suite plus
architect's independent re-verification already cover every root-scoped read,
the cwd-invariance property, the dormant-role chase-rotate path, and the
cwd-fallback regression guard. This pass re-verified all of it independently
and found no gap. Forwarding to documenter.
