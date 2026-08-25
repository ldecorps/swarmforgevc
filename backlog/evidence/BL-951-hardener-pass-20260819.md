# BL-951 hardener pass — 2026-08-19

## Reviewed commit
`66a1ca9084` ("BL-951: architect pass - clean, forwarding to hardener"),
merged into hardener as this parcel. No bounce.

## Why this pass got extra scrutiny
This ticket fixes `swarm_handoff.bb`'s `route-required-stages` — the exact
send-path function every `swarm_handoff.sh` call in this swarm goes
through, including every one of my own hardener sends this session. Read
the core fix in full rather than relying on suite re-runs alone.

## Scope, precisely
`git show --stat b2ec618e73` — 4 files: the new acceptance step handler,
`index.js`'s registry line, `swarm_handoff.bb` itself, and the new
property runner. No `extension/` file touched (confirmed and independently
re-verified — dependency-gate correctly errors "can't open" against these
paths, matching the architect's own finding). Stryker/CRAP/DRY
inapplicable.

## Checks run (complete inventory, not first-failure-stop)

1. **Host load**: 34–117 on 4 cores — the most extreme swing this session
   has seen (spiked to 117, settled to ~45-70 during this pass). The
   property runner and acceptance feature both showed genuine (if slow)
   CPU accrual rather than the flat-zero tool-wedge signature documented
   elsewhere this session, so both were run to completion via
   `run_in_background` + `Monitor` rather than killed — a real, if slow,
   run beats a premature no-verdict when the process is demonstrably
   making progress.
2. **Independent re-run of the property runner**:
   `bb swarmforge/scripts/test/bl951_stage_skip_recording_property_runner.bb`
   — ok, 12 sampled hops, matching the architect's report.
3. **Independent re-run of all three regression suites** (proving no
   sibling salvage-path regression):
   - `bb swarmforge/scripts/test/required_stages_test_runner.bb` — ALL
     PASS.
   - `bash swarmforge/scripts/test/test_redo_from.sh` — ALL PASS (11
     scenarios, including the required_stages-routing-leaves-target-
     untouched case).
   - `bash swarmforge/scripts/test/test_reroute.sh` — ALL PASS (9
     scenarios, same untouched-target case for reroute).
4. **Acceptance, independently re-run**: 7/7 PASS, matching the
   architect's 7/7.
5. **Own full read of `route-required-stages`** (own hardening judgment,
   given this function's live blast radius): traced both branches at the
   `(if (or (nil? decision) (= :default-full (:source decision))) ...)`
   split — confirmed BOTH branches now call `emit-skip` unconditionally
   (the actual fix: recording no longer sits behind the early return),
   while only the REWRITE half (choosing `next-stage` when the literal
   recipient falls outside the effective set) stays gated on a usable
   declaration, matching invariant 2 exactly. Confirmed the outer guard
   (not git_handoff / multi-recipient / rejection_reason / reroute_reason
   / not routes-forward) is unchanged from pre-fix and correctly still
   excludes bounces, reroutes, and non-forward sends from recording at
   all — matching the ticket's own explicit exclusions.
6. **Required wiring**: `bl951StageSkipsRecordedSteps` confirmed
   registered in `specs/pipeline/steps/index.js` (grepped directly).
7. **Leak/process check**: `git status --short` clean; no stray tmux
   servers; no leftover Babashka/node processes from either background
   run.

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling (no `extension/`
file touched). Property runner, all three regression suites (including
the two salvage-path siblings, redo_from and reroute), and the acceptance
feature all independently reconfirmed green under extreme and fluctuating
host load, run safely to completion via backgrounded + monitored
invocations rather than blocked by the sandbox's foreground timeout.
Independently traced the core fix's branch structure and confirmed it
matches the ticket's own stated invariants exactly.

Forwarding to documenter.

By hardener.
