# BL-939 hardener pass — 2026-08-19

## Reviewed commit
`dfa351f0b1` (architect merge, clean sweep — see
`backlog/evidence/BL-939-smoke-check-stale-expectation-architect-pass-20260819.md`).

## Tooling scope check
No `extension/src/*.ts` file is touched by this parcel (confirmed via
`git show --stat` on the coder commit — only
`swarmforge/scripts/smoke_check_stabilize_two_pack.sh`, the new
`specs/pipeline/steps/bl939TwoPackSmokeCheckDropsCoordinatorWindowSteps.js`,
and a 1-line append to `specs/pipeline/steps/index.js`). Stryker/CRAP/DRY
are therefore all inapplicable, same as BL-938 earlier today — bash
parcel, gated only by its own suite (Testability Boundary).

## Checks run (complete inventory, not first-failure-stop)

1. **Leftover process/fixture check before starting**: clean.
2. **Independently ran the fixed smoke check**:
   `/bin/bash swarmforge/scripts/smoke_check_stabilize_two_pack.sh` — 
   `SMOKE PASS`, all four checks OK, against the real unchanged profile.
3. **Independently re-verified invariant 1's rejection premise** (not just
   read from the architect's report): scratch-copied the real profile,
   appended `window coordinator claude coordinator`, ran the real
   `parse_config` (`zsh -c "source swarmforge.sh '<root>'; parse_config"`,
   matching the step handler's own invocation shape) — exits non-zero,
   `coordinator is reserved infrastructure and may not be declared as a
   window`. Confirms adding the coordinator line (the check's stale
   pre-fix advice) really would break `./swarm`.
4. **Independently re-verified invariant 2's non-vacuity myself**: backed
   up the real `stabilize-two-pack.conf`, removed its `window cleaner`
   line in place, ran the real smoke check — `SMOKE FAIL: profile defines
   roles [coder], expected [coder cleaner] ...`, correctly names the
   missing role. Restored the real file from the backup immediately after;
   `git status --short` confirmed clean, no stray diff.
5. **Independently ran the full acceptance feature**: `run_acceptance.sh
   specs/features/BL-939-two-pack-smoke-check-stops-demanding-a-coordinator-window.feature`
   — 4/4 scenarios pass (named scenario, 2-row Outline, named scenario).
6. **BL-149 cooldown gate**: `mutation_cooldown_gate.bb` on
   `swarmforge/scripts/smoke_check_stabilize_two_pack.sh` returned
   `skip-cooldown` (file age 0.08 days, inside the 3-day window) —
   skip unconditionally per the gate's own rule, regardless of host load.
   The feature has one `Scenario Outline`, so BL-113 applies in principle,
   but the file the check drives is still fresh/churning today; deferred
   to a later pass once past cooldown. This is a cleaner, more clear-cut
   reason than BL-923's load-based deferral minutes earlier — not
   ambiguous with busy-host reasoning.

## Outcome
No defects found. No applicable Stryker/CRAP/DRY tooling (bash parcel,
testability boundary). BL-113 Gherkin mutation deferred per BL-149
cooldown gate (`skip-cooldown`, file 0.08 days old), not run this pass.
Independently re-verified the fix and both invariants beyond what the
architect already checked once, restoring the live profile file cleanly
after each scratch probe.

Forwarding to documenter.

By hardener.
