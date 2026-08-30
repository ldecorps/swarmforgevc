# BL-1281 — hardener pass

Hardener, 2026-08-30.

## Scope

Every changed file is `extension/test/**` (property tests + shared helper) or
acceptance-pipeline step/registry code — no `extension/src` involvement, so
Stryker/CRAP/DRY do not apply (same basis as the architect's review and the
prior BL-1274/1277/1279/1280 passes this shift).

## Hand-authored mutation sweep

**Mutant: revert `drawForShape` in `extension/test/helpers/bl1048ReachFloors.js`
to the old unpinned `sampledDraw()`.** This is the exact regression the
ticket exists to prevent and the coder's own non-vacuity demonstration
(reproduced independently here rather than trusted from prose). Hand-mutated
and re-ran `bl1281ReachFloorConstructionInvariants.property.test.js`: 2 of 4
tests go red — `AssertionError: seed 26: openedOnly still short after the
fix` — naming the exact pinned control seed and the exact floor that misses,
which is invariant 1's deterministic control doing its job. Restored; diff
clean; both `bl1281...` (4/4) and `bl1048...` (1/1) property tests green
again.

## Verification

- `npm run test:properties -- bl1048` — 1/1 (~1.1s, matching the coder's
  claimed post-fix speed).
- `npm run test:properties -- bl1281` — 4/4.
- `node specs/pipeline/cli.js specs/features/BL-1281-...feature` — 5/5.
- Full `vitest run --config vitest.config.mjs` (after `npm run compile`):
  **26 failed files / 218 failed tests / 9443 passed** — identical to the
  BL-1277/BL-1280 hardening baseline; bl1048/bl1281 are properties-lane
  files, outside this lane's scope, so no change expected or observed.
- Whole-tree guards for `extension/test/`: the same standing 3 as the
  BL-1277 pass (`liveRepoDerivationGuard`, `socketFixtureShortRootGuard`,
  `tempDirTrapGuard`) — pre-existing, unrelated debt, confirmed by earlier
  passes this shift to name neither `bl1048` nor `bl1281`.

## Not independently re-run this pass

The 5-explicit-seed run (`PROPERTY_SEED={1,7,4242,99,12345}`) and the
2000-simulated-run miss-rate table are numeric-simulation claims the coder
and architect both already reproduced directly (architect: "Re-ran the
coder's headline claims directly"). The hand-authored mutation kill above is
a stronger, more direct proof that the construction guarantee is real and
tested, so it was prioritized over re-running the same simulation a third
time.

## CRAP / DRY / mutation-site count

Not applicable — no `extension/src` file in this ticket's diff.

Forwarding to documenter.
