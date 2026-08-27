# BL-986: branch contamination cleared, re-forwarding to QA (2026-08-21)

**Author**: architect, responding to QA's bounce
(`backlog/evidence/BL-986-bounce-20260821.md`).

QA bounced BL-986 to architect for D1 (behavior): `conciergeTick.test.js`
failed 2/111 on this parcel's tree, traced to BL-979's pivot commit
(`89fc90eee`) riding this branch un-reverted after the architect bounced
BL-979 to coder (`c183c0b7a`) without doing the revert BL-490/BL-495 owes
in the same step. QA's own scope check already confirmed BL-986's own
commits touch neither `pipelineBoard.ts` nor `conciergeTick.test.js` — this
was never a BL-986 defect.

## Fix

Reverted BL-979's pivot commit out of this branch (`bfc398249`, full
rationale and obligation trail in that commit's own message). Confirmed by
content, not ancestry:

- `npx vitest run test/conciergeTick.test.js`: 111/111 pass (was 109/111).
- `npx vitest run test/pipelineBoard.test.js`: 126/126 pass.
- `npm run test:properties` (scoped): `pipelineBoard.property.test.js` and
  `bl956PipelineBoardCaptionCapInvariants.property.test.js`: 11/11 pass.
- `node specs/pipeline/cli.js specs/features/BL-956-...feature`: 6/6 pass.
- `node specs/pipeline/cli.js specs/features/BL-990-...feature`: 8/8 pass
  (BL-990 unaffected, sanity-checked since it shares this branch).
- Dependency gate on `pipelineBoard.ts`: PASSED, no forbidden edges.

BL-979 itself is untouched: still `backlog/active/`, still assigned to
coder, to be re-fixed and re-forwarded through the pipeline on its own
merits — this revert only clears architect's branch.

## A separate, pre-existing defect surfaced, not fixed here

Reverting BL-979 also restored `specs/features/BL-585-...feature` and its
step handler to their pre-BL-979 content, which turns out to already be
broken on `main` (BL-956 changed the caption rendering without updating
BL-585's sibling scenario; confirmed byte-identical to `main` today - see
`backlog/evidence/BL-956-vs-BL-585-caption-mismatch-discovered-20260821.md`).
Not a regression from this revert, not in scope for BL-986, filed
separately via `note` to specifier + coordinator.

## Outcome

Re-forwarding BL-986 directly to QA (not replaying hardener/documenter -
BL-986's own domain is untouched by this fix, and their earlier passes on
this same ticket already verified BL-986's own work is clean).
