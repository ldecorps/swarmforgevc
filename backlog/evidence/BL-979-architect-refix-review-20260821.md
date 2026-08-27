# BL-979 D1 refix: architect re-review, PASS (2026-08-21)

**Reviewer**: architect.
**Reviewed**: coder's refix `ae6d0070b` ("BL-979 D1 refix: re-express
conciergeTick's two pre-pivot header asserts"), forwarded via cleaner
(`e8ad302017`).

## The bounce this answers

`backlog/evidence/BL-979-architect-bounce-20260821.md` (D1, behavior):
`conciergeTick.test.js:2199/2436` still asserted the pre-pivot "matrix
header carries ticket ids" shape and failed against BL-979's own row-per-
ticket renderer output.

## Reconciling with the branch-contamination detour

Between the bounce and this refix landing, QA bounced an unrelated ticket
(BL-986) for exactly this un-reverted BL-979 content riding the branch
(`backlog/evidence/BL-986-bounce-20260821.md`), which I answered by
reverting BL-979's pivot commit out of the branch (`bfc398249`) so BL-986
could be re-forwarded clean
(`backlog/evidence/BL-986-architect-contamination-cleared-20260821.md`).

That revert was still in place when this refix parcel arrived. Merging
coder's refix as-is reintroduced 2/111 `conciergeTick.test.js` failures -
the SAME two, inverted: the test now asserted the row-per-ticket shape
while `pipelineBoard.ts` had been reverted back to the column-per-ticket
shape. Restored the pivot (`50c1c279d`, reverting my own stopgap revert)
to reunite it with the now-fixed test. This does not touch BL-986's
already-forwarded parcel (`3d3506d6af`, sent to QA before this refix
arrived) - that commit is fixed history, unaffected by later commits on
this branch.

## Re-expression quality

Read `ae6d0070b` in full. It preserves every assertion the original test
made, adapted for the axis pivot rather than weakened:

- folders.active -> board join: now reads ids from row gutters (was header).
- epic/title caption join: caption-vs-row discriminated by SHAPE (a row is
  an id + exactly 8 marks; a caption is an id + prose), not position.
- role-held join: still asserts exactly one mark per holder, AND that the
  mark sits at the correct stage INDEX (not just present anywhere), AND
  (via the shared `ticketRows`/`rowFor` helpers) implicitly that no other
  ticket's row carries a stray mark for that ticket's own row shape.
- BL-473 (unheld ticket, not-started): same pattern - one row, one mark, at
  the NS column index specifically, not merely "some mark exists".

No weakening, no passthrough assertion, no vacuity.

## Verification

- `npm run compile`: clean.
- `conciergeTick.test.js`: 111/111 (was 109/111 before this refix).
- `pipelineBoard.test.js`: 126/126. `bl979PipelineBoardTicketRows.test.js`:
  15/15.
- Board/concierge sweep (9 files, folding in pipelineBoardSync,
  pipelineBoardPinSync, conciergeTopicRouting, conciergeTickScheduler,
  runOneConciergeTick, conciergeTickRequest): 386/386.
- Property tests (`pipelineBoard.property.test.js`,
  `bl956...Invariants.property.test.js`): 11/11.
- Acceptance: BL-585 8/8, BL-956 5/5, BL-990 8/8 (sanity, shares branch).
- Dependency gate on `pipelineBoard.ts` + `conciergeTick.test.js`: PASSED,
  no forbidden edges.

## Outcome

BL-979 D1 is cleared. Forwarding to hardender.
