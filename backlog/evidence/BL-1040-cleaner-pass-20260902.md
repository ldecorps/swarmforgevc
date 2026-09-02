# BL-1040 — cleaner pass, 2026-09-02

Role: cleaner. Ticket: BL-1040-seat-identity-never-escapes-on-the-observation-path.

## Received
Coder commit `75e8f5909c`: folds seat identity onto its stage on the three
observation-path layers (`pipeline_stage_cli.bb`, `swarmState.ts`,
`pipelineBoard.ts`). Merged into cleaner at the merge commit preceding this
one.

## Verification (independent re-run)
- `extension`: `npm run compile` clean.
- `npx vitest run test/pipelineBoard.test.js test/state.test.js` — 172/172 pass.
- `npx vitest run --config vitest.properties.config.mjs test/bl1040SeatIdentityObservationPath.property.test.js` — 4/4 pass.
- `node specs/pipeline/cli.js specs/features/BL-1040-seat-identity-never-escapes-on-the-observation-path.feature` — 6/6 pass.
- `bash swarmforge/scripts/test/test_pipeline_stage_cli.sh` — ALL CHECKS PASSED, including all four BL-1040 cases.

## Cleanup applied
- `extension/src/concierge/pipelineBoard.ts::heldRoleByTicketId` — the
  coder's version recomputed `stageOfSeat` for every `(stage, key)` pair via
  a nested `ALL_SWARM_ROLES × Object.entries(roleHeldTickets)` loop.
  Refactored to a single pass that groups ids by stage first
  (`idsByStage`), then walks `ALL_SWARM_ROLES` once to build the final map —
  same "later stage wins" precedence and the same per-stage insertion order
  (both load-bearing, per the existing comment), just without the redundant
  O(roles × keys) rescan. Behavior-preserving: reran the full test set above
  after the edit, all still green.
- No other structural issues found. The bb-side change
  (`role-for-observation`, `compute-stage-map`) reuses the existing
  `handoff-lib/seat-stage` chokepoint as directed by the ticket rather than
  a fourth hand-rolled `@`-split — no duplication to remove.

## CRAP / DRY / mutation-site checks
- `jscpd` on the two touched TS files: 3 clones found, all located well
  outside the BL-1040 diff regions (lines 635-1400 vs the edited
  475-495/204-237 ranges) — pre-existing, not introduced here.
- Mutation-site count (BL-485, `node extension/out/tools/mutation-site-count.js`):
  `pipelineBoard.ts` 1005 sites (over), `swarmState.ts` 224 sites (over).
  Both are pre-existing large, cohesive modules; BL-1040's own diff to each
  is a handful of lines. A split now would be a mechanical chop unrelated to
  this ticket's scope and would not improve separation of concerns for the
  actual change — advisory noted, not acted on, per BL-485's own soft-gate
  language ("never a mechanical line-count chop just to duck the count").
- Babashka: no mutation/CRAP/DRY wired (BL-472 deferred) — the bb-side change
  is gated by `test_pipeline_stage_cli.sh` only; recorded, not implied to
  have run mutation.

## D1..Dn (Article 4.4 complete inventory)
NONE beyond the efficiency cleanup above, which is not a defect (behavior
was already correct) but a structural improvement made during this pass.

## Disposition
Forward to architect.

By cleaner.
