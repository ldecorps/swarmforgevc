# BL-1281 — architect review

Architect, 2026-08-30. Reviewed cleaner's merge of coder's `9de949d3db`.
Resolved one merge conflict in `specs/pipeline/steps/index.js` (both sides
added a require entry — kept both, `bl1280` then `bl1281`).

## Checks run, all clean

- `node extension/out/tools/dependency-gate.js` (full-repo AND the parcel's
  own changed files) — PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js` against the parcel's new
  files — no history yet, nothing flagged.
- Invariants Review (BL-633/654): both declared invariants have a live,
  non-vacuous property test
  (`bl1281ReachFloorConstructionInvariants.property.test.js`). Re-ran
  `npm run test:properties -- bl1281`: 4/4. Invariant 1 quantifies over 200
  drawn seeds (construction-guaranteed reach) plus a DETERMINISTIC control of
  six seeds found to miss under the old sampled scheme — a real proof the fix
  changes behaviour, not a coincidental green. Invariant 2 freezes the
  pre-change floor values and asserts both weakening shapes (lowered,
  dropped) are caught for every one of the nine floors.
- Required wiring verified directly: `bl1048DeliveredParcelIsNotNotStarted.property.test.js`
  imports `assertReachFloor`/`runsPerCell` from BL-1062's
  `./helpers/reachFloors` (line 9) and calls `assertReachFloor` at line 339 —
  drives the shared helper, not a local restatement of it. The new
  `helpers/bl1048ReachFloors.js` holds domain data (shapes, floor values,
  ticket arbitraries) consumed by bl1048, the property lane, AND the
  acceptance handler — one generator, not three copies that could drift.
- Floor values verified unchanged: diffed the pre-change inline
  `assert.ok(coverage.X >= N)` lines (commit `9de949d3db^`) against
  `BL1048_REACH_FLOORS` in the new helper — all nine floors present, same
  values, none lowered.
- Confirmed `bl1048DeliveredParcelIsNotNotStarted.property.test.js` is still
  absent from `swarmforge/scripts/property_suite_standing_allowlist.tsv`
  (grep, exit 1) — the flake is removed, not tolerated, per the ticket's
  second constraint.
- Re-ran the coder's headline claims directly:
  - `npm run test:properties -- bl1048`: 1/1.
  - `PROPERTY_SEED={1,7,4242,99,12345} npx vitest run ... bl1048`: 5/5.
  - `npm run test:properties -- bl1281`: 4/4.
  - `node specs/pipeline/cli.js specs/features/BL-1281-...feature`: 5/5.
  - Full `vitest run --config vitest.config.mjs`: 26 failed / 218 failed
    tests — identical to the pre-BL-1281 baseline (bl1048 is a
    `.property.test.js`, outside this lane's scope). No regression.
- Architecture: no layering concern. `helpers/bl1048ReachFloors.js` is a
  pure, testable module (accepts `fc` as a parameter rather than requiring
  it, so it loads outside vitest for the acceptance handler too — correct
  single-instance-of-fast-check design). No `extension/src` touched; CRAP/
  mutation/DRY gates don't apply (same basis as the prior four cleaner/
  architect passes this shift).

No defect found. Forwarding to hardener.
