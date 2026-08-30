# BL-1279 — hardener pass

Hardener, 2026-08-30.

## Scope

Every changed file is a shell script/lib, a `.bb` closure CLI, or
acceptance-pipeline step/property-test JS — no `extension/src` compiled to
`out/`, so Stryker/CRAP/DRY do not apply (same basis as the cleaner's
evidence). This is a no-wired-mutation-tool surface (BL-638 fallback):
hardening here is re-verification plus a hand-authored mutation check on the
ticket's own new mechanism.

## Hand-authored mutation sweep

**Mutant: drop the `exit 1` from `assert_bb_closure_present`'s missing-closure
branch** (`swarmforge/scripts/test/lib/bb_fixture_load_guard.sh`) — the exact
hazard invariant 2 exists to close (a guard that logs FAIL but lets execution
continue would let every downstream check keep running and reintroduce the
"crash satisfies a negative assertion by accident" defect this ticket fixes).
Hand-mutated, re-ran the ticket's own acceptance feature: scenario 10 ("a
fixture whose subprocess dies at load time reports no passed checks") goes
red — the `echo "ok - a check that must never be reached"` step now runs and
is reported passed, which the scenario's own assertion catches. Restored;
file diff clean; full suite re-confirmed 10/10 green.

## Verification

- All four fixtures standalone: `test_front_desk_supervisor_bl622_refusal.sh`,
  `test_front_desk_supervisor_tick.sh`, `test_front_desk_supervisor_liveness.sh`,
  `test_front_desk_supervisor_fleet_creds.sh` — ALL CHECKS PASSED, exit 0,
  each.
- `node specs/pipeline/cli.js specs/features/BL-1279-...feature` — 10/10.
- `extension/test/bl1279FrontDeskFixtureClosure.property.test.js` (properties
  lane) — 2/2.
- `BL-973-copy-lists-closure-derived-and-suite-completeness.feature` re-run —
  12/13, same single pre-existing red the coder and cleaner already
  documented (a BL-1276 manifest-naming row, unrelated to this ticket,
  present before BL-1279 landed).
- `extension/test/operatorRuntimeBbFixtureClosure.test.js` — 4 pass / 2 fail,
  matching the coder's evidence exactly: the 2 failures are about
  `operator_runtime.bb`'s closure (a different entry point entirely), not
  `front_desk_supervisor.bb`. Confirmed unrelated by reading the failing
  test names.
- Whole-tree guards for the trees this parcel touches
  (`specs/pipeline/steps/`, `extension/test/`): the same 4 pre-existing
  failures as BL-1274's pass (`liveRepoDerivationGuard`,
  `socketFixtureShortRootGuard`, `tempDirTrapGuard`, `tmpDirMigrationGuard`) —
  grepped their output for `bl1279`/`front_desk_supervisor`/
  `bb_fixture_load_guard` — no hits. Standing debt, out of scope.

## CRAP / DRY / mutation-site count

Not applicable — no `extension/src` file in this ticket's diff.

Forwarding to documenter.
