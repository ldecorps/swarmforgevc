# BL-952 hardener pass — 2026-08-19

## Reviewed commit
`c2bd4a2aac` ("BL-952: architect pass - clean, forwarding to hardener"),
merged into hardener as this parcel. No bounce.

## Why this pass got extra scrutiny
This ticket fixes the shared predicate (`is_qa_ancestor.sh`) that decides
what is allowed to land on `main` — the same predicate `check_pipeline_-
code_on_main.sh` (BL-631, hardened earlier today) and `babysitter_check.bb`
both shell. A live incident (BL-945's twice-bounced code reaching
`origin/main`) motivated it. Read the core logic in full rather than
relying on suite re-runs alone.

## Coverage gap closed (flagged by the architect for this pass)
The architect's own evidence explicitly noted: `is_qa_ancestor.sh`
implements two independent bounce-verdict stores (a JSONL store and
tracked ticket-YAML `bounce_history`), but every test in the parcel (unit,
property, acceptance) drove only the JSONL path. The YAML-store branch was
verified correct by the architect BY HAND, once, with no automated
coverage guarding it going forward — a real gap on a safety-critical
fail-closed gate.

Added `swarmforge/scripts/test/test_is_qa_ancestor_yaml_store.sh`: builds
a fixture repo with a bounce recorded EXCLUSIVELY via a tracked ticket
YAML's `bounce_history` (no `.swarmforge/bounces/*.jsonl` entry anywhere),
and confirms `is_qa_ancestor.sh` still refuses (exit 1, naming the
ticket-YAML source), plus confirms a genuinely unrelated approved commit
in the SAME repo (same YAML file present) still reads exit 0 — proving
the match is precise, not a blanket refusal once any bounce record exists
anywhere in `backlog/`.

**Non-vacuity independently verified by hand**: commented out the
YAML-store branch in `is_qa_ancestor.sh` (`if false && [[ -d backlog ]]`),
re-ran the new test — 2 of 4 checks failed exactly as expected (the
refusal and its message); restored the source, confirmed `git diff` empty,
reconfirmed all 4 checks green again.

**Leak check**: before/after `tmp.*` count under `$TMPDIR` unchanged
across a run of the new test — its own fixture root is cleaned up
correctly.

## Checks run (complete inventory, not first-failure-stop)

1. **Host load**: started at 9–16 on 4 cores (much quieter than earlier
   this session's 113+ peak), dropped further mid-pass. BL-149 cooldown
   gate on the changed files reported `run` for the fresher ones.
2. **BL-113 Gherkin mutation attempted, given the quiet host** (both of
   the feature's Scenario Outlines): stalled at `completed=0` with FLAT
   CPU (~0.1s total across both worker processes over 5+ minutes wall
   clock) — the documented flat-CPU tool-wedge signature, distinct from a
   load-crash or the BL-788 cross-step leak hazard (this file's daemon
   fixture is cleaned via an unconditional `afterEach`, not a
   terminal-step-only inline call, so the BL-788 hazard does not apply
   here). Killed both worker processes and the runner script cleanly;
   confirmed no leak (`git status --short` clean, no stray tmux, no
   leftover `node --test`/`bb gherkin-mutator` processes). Recorded as
   **no verdict** (neither pass nor fail) per the established handling for
   this failure class — this is the first stall on this feature, not a
   second occurrence, so no tool-defect ticket is warranted yet.
3. **Independent re-run of the existing bb suites**:
   - `bb swarmforge/scripts/test/push_sweep_lib_test_runner.bb` — ALL
     TESTS PASSED (includes the 5 new BL-952 truth-table rows).
   - `bb swarmforge/scripts/test/push_sweep_lib_property_runner.bb` —
     500 runs, ALL PROPERTIES HOLD, including 6 non-vacuity
     confirmations.
4. **Acceptance, independently re-run three times**: 9/10, 9/10, then
   10/10 — the one intermittent failure (`ENOTEMPTY` removing the daemon
   fixture's tmp dir in `afterEach`) is the same pre-existing
   daemon-fixture teardown race the coder's own commit message and the
   architect's evidence both already document and reproduce independently
   (SIGTERM sent to the daemon, then `rmSync` races the dying process's
   own in-flight writes) — not a BL-952 regression, not blocking.
5. **Own independent correctness read of the `:tip-is-qa-ancestor?` fast
   path** (beyond what either evidence file described): the pure
   `qa-gate-decision` in `push_sweep_lib.bb` still has a
   `tip-is-qa-ancestor? -> {:refuse? false ...}` branch that runs BEFORE
   the `:bounced?` veto — read in isolation this looked like a possible
   reopening of the exact hole this ticket closes (a bounced TIP commit
   would itself read `:tip-is-qa-ancestor? true`, since bounced commits
   stay reachable from `swarmforge-QA`). Traced it to the real gatherer,
   `push-sweep-qa-gate-facts!` in `handoffd.bb` (lines 2564-2583): it now
   HARDCODES `:tip-is-qa-ancestor? false` in every branch, so the pure
   lib's fast path is permanently dead in the live wiring — kept only for
   the pure lib's own existing unit tests, never supplied `true` by any
   real caller. The code's own comments (2564-2574) document exactly this
   reasoning. No defect; confirms the fix is complete, not merely
   plausible.
6. **`ahead-commit-facts`'s merge-commit branch**: confirmed both the
   merge and non-merge branches now call the shared `qa-ancestor?`
   predicate and thread `:bounced?` through — the merge branch previously
   never consulted it at all (per the code's own comment), which would
   have left a bounced MERGE commit invisible to the veto.
7. **Leak/process check**: `git status --short` clean except my own new
   test file; no stray tmux servers; no leftover daemon processes after
   the acceptance runs.

## Outcome
No defects found. Closed the one coverage gap the architect explicitly
flagged, with independently-verified non-vacuity. BL-113 attempted and
recorded as stalled (no verdict), not silently skipped or falsely claimed
green. Both bb suites reconfirmed green; the acceptance feature's one
intermittent failure confirmed to be the same pre-existing, already-
documented daemon-teardown race, not a regression. Independently traced
the `:tip-is-qa-ancestor?` fast path through to the real gatherer and
confirmed it is permanently disarmed in production, closing a concern that
looked plausible on inspection of the pure lib alone.

Forwarding to documenter.

By hardener.
