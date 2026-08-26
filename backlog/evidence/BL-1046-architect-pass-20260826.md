# BL-1046 — architect pass — 20260826

- merge_and_process cleaner tip `08029f31f8` (conflict in
  `residentSpyUiHtml.test.js` vs prior BL-1153 bounce revert — kept BL-1046
  grid-tile test only).
- Worktree recovered after property-suite-guard pollution during first merge
  attempt (`reset --hard a2c0b3522`, rematch merge with skip-guard).

## Architecture / boundaries

- Grid tile renders existing `PaneLiveSnapshot` fields (`ticketId`,
  `ticketTitle`, `claimEnteredAtMs`, `heldParcelCount`) — no second
  derivation in `residentSpyUiHtml.ts` (invariant 2).
- Per-seat mailbox resolution stays in `residentPaneSpy.ts` /
  `resolveResidentHeldTicketMeta` (invariant 1).
- dependency-gate on parcel bridge sources: **PASSED**.

## Required wiring

- APS `bl1046ConsoleTileSteps` registered in index.

## Verification

- Vitest: `residentSpyUiHtml.test.js` 10/10, `residentPaneSpy.test.js` 18/18,
  `bl994LiveScreenGrid.test.js` 8/8 (36/36).
- Mock artifact + delivery evidence present from coder tip.

Pass → hardender.

By architect.
