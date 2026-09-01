# BL-1316 Hardener Pass — 2026-09-01

## Ticket
BL-1316: A seat's reasoning effort follows the claimed ticket's mutation_cost

## Reviewed commit
850c337e44 (architect forward, PASS)

## Scope
Babashka-only change (`swarmforge/scripts/seat_difficulty_lib.bb`,
`swarmforge/scripts/handoff_lib.bb::apply-claim-effort!`) plus step file
`specs/pipeline/steps/bl1316ClaimTimeEffortSteps.js`. Per engineering.prompt
Startup Tools, Babashka has no mutation/CRAP/DRY tooling wired (BL-472
deferred) — gated only by its own unit-test suite. This pass records the
degraded fallback; no mutation/CRAP/DRY tool ran over this code.

## Unit suites (real runs, this pass)
- `bb swarmforge/scripts/test/seat_difficulty_lib_test_runner.bb` — ALL PASS
- `bb swarmforge/scripts/test/handoff_lib_test_runner.bb` — ALL TESTS PASSED
  (BL-365 suite; corrupt/unresolvable/ambulance-hold fixtures behaved as
  expected, unrelated to this ticket)
- `bb swarmforge/scripts/test/bl1316_claim_time_effort_property_runner.bb` —
  ALL PROPERTIES HELD (inv1 cost-present=149 cost-absent=51, inv2
  no-lever-backend=200, inv3 cost-present=804 cost-absent-restores=295).
  Architect already confirmed this property runner is non-vacuous
  (deliberately-broken-code check documented in its own comments).

## Acceptance (BL-1316-claim-time-effort-follows-ticket-difficulty.feature)
`specs/pipeline/scripts/run_acceptance.sh` — 6/6 pass (all scenarios/examples
green, including the mutation_cost-absent fallback and the no-lever-backend
case).

## BL-113 Gherkin acceptance mutation (soft)
Already present in the worktree from an earlier, interrupted pass at this
ticket's current feature text (mutation-stamp `bb97c3d0…`, manifest embedded
in the `.feature` file): scenario "claiming a ticket sets effort from its
mutation_cost", 6/6 mutants Killed, 0 Survived, 0 Errors. Re-confirmed live
by re-running acceptance (6/6 pass) — feature text unchanged since the stamp
was written, so per BL-460 this is the durable verdict, not a stale marker.
Committing that manifest as part of this pass.

## Standing whole-tree guards (parcel touches specs/pipeline/steps/)
Ran all 16 `test/*Guard*.test.js` files (excluding `.property.` siblings).
3 failed, all pre-existing and unrelated:
- `tempDirTrapGuard.test.js` — violations in unrelated `swarmforge/scripts/test/*`
  files, already ticketed `backlog/paused/BL-1289-a-temp-root-is-always-cleaned-up.yaml`
- `socketFixtureShortRootGuard.test.js` — violations in
  `bl1112StandingUnitRedsSteps.js` / `bl691AmbulanceWorkflowGapsSteps.js`,
  already ticketed `backlog/paused/BL-1290-a-socket-fixture-is-rooted-short-enough-to-bind.yaml`
- `liveRepoDerivationGuard.test.js` — already ticketed
  `backlog/paused/BL-1291-a-live-repo-read-is-pinned-or-justified.yaml`
Confirmed via grep: none of the three violation lists names
`bl1316ClaimTimeEffortSteps.js` or any file this ticket touches (matches
`backlog/evidence/BL-1308-hardener-pass-20260831.md`'s prior confirmation of
the same three tickets). No bounce.

## Orphan/process check
`pgrep -fl 'node --test|stryker'` scoped to this worktree: clean before and
after. No detached jobs used this pass (all runs completed within the
foreground timeout).

## Verdict
Hardened. Forward to documenter.

By hardener.
