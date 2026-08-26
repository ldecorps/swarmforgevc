# BL-1094 — hardener pass, 2026-08-24

## Inbound

Merged architect `1a65b20e63` (on cleaner `28f253d156` / coder
`80fe63fe94`) into `swarmforge-hardender`. Merge commit named the
paused→debt park ids absorbed with the tip so the ticket-deletion guard
accepted the rename set.

## Scope

Exempt the daemon's dispatch-gap auto-route from BL-953 via
`SWARMFORGE_DISPATCH_GAP_AUTOROUTE` (option a); keep hand-authored
stale-draft refusal; name the refusing gate in operator logs.

Parcel surface (coder + cleaner): `.bb` gate lib / `swarm_handoff` /
`handoffd` / harness + APS steps + property test. No parcel tip change to
`extension/src/**` — Stryker/CRAP/DRY N/A (degraded `.bb` gate = unit +
hand-authored surgical).

## Host

Load ~5.5 on 20 cores (quiet). No orphaned mutation processes.

## BL-113 Gherkin (soft)

```
total=3 completed=3 killed=3 survived=0 errors=0
outcome: "pass"
```

Manifest stamped into the feature (Outline 01 only; scenarios 02/03 are
plain `Scenario:` — covered by surgical sweep).

## Hand-authored surgical sweep

| # | Mutant | Result |
|---|--------|--------|
| M1 | `check-enabled?` always true (no exemption) | killed (unit) |
| M2 | `check-enabled?` always false (disarm gate) | killed (unit) |
| M3 | coherence gate label → BL-000 | killed (unit) |
| M4 | drop `gate=` prefix from log line | killed (unit) |
| M5 | handoff-validation label → unknown | killed (unit) |
| M6 | remove handoffd `DISPATCH_GAP` env assoc | **survived** (first pass) |
| M7 | swarm_handoff ignore `check-enabled?` | killed (acceptance) |

**M6 gap:** acceptance and the property send fixture set the env via the
harness / test env, so deleting the production `auto-route!` assoc left
every suite green. Closed by extending
`task_commit_coherence_gate_lib_test_runner.bb` with a source-wiring
assert that `handoffd.bb` and `dispatch_gap_sweep_harness.bb` both set
`dispatch-gap-autoroute-env "1"`. Re-sweep: M6 killed by unit; M1/M2
still killed; survivors=0.

## Verification

- Unit: `bb …/task_commit_coherence_gate_lib_test_runner.bb` → ALL PASS
- APS unit: `node --test specs/pipeline/test/steps/dispatchGapSteps.test.js` → 18/18
- Acceptance: 5/5 (fresh compile)
- Properties: 2/2
- Standing whole-tree guards: 13 files / 125 tests pass
- CRAP / DRY / Stryker: N/A (no changed `src/*.ts` in parcel tip)

## Findings

NONE (after M6 wiring lock).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1094-the-auto-route-cites-head-so-the-coherence-gate-blocks-it`.

By hardender.
