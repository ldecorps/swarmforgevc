# BL-1094 — architect pass, clean review (Article 4.4: NONE)

Reviewed cleaner `28f253d156` (on coder `80fe63fe94`) into
`swarmforge-architect`. Merge completed after naming the paused→debt park
ids absorbed with the tip (same set the coder merge already named) so the
ticket-deletion guard could accept the rename set. Ancestry confirmed.

## Scope

Exempt the daemon's dispatch-gap auto-route from the BL-953 coherence gate
via a narrow env seam; keep hand-authored stale-draft refusal intact; name
the refusing gate in operator logs.

Parcel surface (coder + cleaner):
- `swarmforge/scripts/task_commit_coherence_gate_lib.bb`
- `swarmforge/scripts/swarm_handoff.bb`
- `swarmforge/scripts/handoffd.bb`
- `swarmforge/scripts/test/dispatch_gap_sweep_harness.bb`
- `swarmforge/scripts/test/task_commit_coherence_gate_lib_test_runner.bb`
- `specs/pipeline/steps/bl1094DispatchGapAutorouteSteps.js` (+ index /
  `dispatchGapSteps` harness touch)
- `extension/test/bl1094DispatchGapAutoroute.property.test.js`
- cleaner evidence

No `extension/src/**` production change in the BL-1094 tip. `blocked?` itself
is untouched.

## Architecture

- Matches approval option (a): a single machine-generated caller is marked
  (`SWARMFORGE_DISPATCH_GAP_AUTOROUTE=1` set only in `auto-route!` and the
  dispatch-gap test harness). Policy stays in
  `task_commit_coherence_gate_lib` (`check-enabled?`); `swarm_handoff.bb`
  consults it; `blocked?` remains the general gate.
- Dependency direction is inward: handoffd/harness → gate lib; no IO/UI
  framework leak into the pure helpers. Cleaner split
  (`coherence-refusal-stderr?` / `refusal-gate-name` /
  `operator-refusal-log-line`) keeps classification under CC 6.
- Integrate-not-fork: maintained SwarmForge scripts only; no webview,
  secrets, or browser storage surface.

## Required hard gate: `node extension/out/tools/dependency-gate.js`

    node extension/out/tools/dependency-gate.js \
      test/bl1094DispatchGapAutoroute.property.test.js
    → PASSED: no forbidden edges.

(Parcel's only extension file is the property test.)

## Co-change (`node extension/out/tools/co-change-report.js`)

Gate lib couples to its test runner, `swarm_handoff.bb`, BL-953 / dispatch-gap
steps — expected for this change. `handoffd.bb` historical SUSPECTED couplings
are pre-existing daemon surface, not introduced by the exemption. Advisory
only; no send-back.

## Invariants review (BL-633/BL-654) — 2 declared, both encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Daemon-generated handoff is accepted by the daemon's own validator | `bl1094DispatchGapAutoroute.property.test.js` + feature Outline 01 | Properties green; acceptance 3/3 subject-name rows deliver. Without env flag, mismatched HEAD still exits with BL-953. |
| 2 | Refusal log names which gate and why | Same property file + feature 02/03 + `operator-refusal-log-line` | Properties assert `gate=`/`reason=`; acceptance hand-authored refuse names coherence gate; unit runner covers handoff-validation / unknown / missing flag. |

Coder non-vacuity claim in the property header (unset flag → RED; unformatted
stderr → no `gate=`). No `invariant-unencoded` item.

## Property-testing support (undeclared)

Declared pair already covers the pure `check-enabled?` /
`operator-refusal-log-line` surface this parcel introduced. No additional
undeclared property authored this pass (would be vacuous duplication).

## Correctness read-through

- Human lean (a) implemented without loosening `blocked?` for everyone.
- Env flag is process-local to the `swarm_handoff` invocation from
  `auto-route!` / harness — not a global disarm.
- Exception path in `auto-route!` still logs `.getMessage` (non-gate throw);
  gate refusals go through `operator-refusal-log-line`. No defect spotted.
- Unit suite ALL PASS; acceptance 5/5; properties 2/2.

## Prior bounce check

No BL-1094 bounce evidence under `backlog/evidence/`.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1094-the-auto-route-cites-head-so-the-coherence-gate-blocks-it`,
commit = this evidence commit (BL-536 / BL-806).

By architect.
