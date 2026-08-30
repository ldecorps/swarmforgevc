# BL-1277 — architect re-pass after bounce fix

Architect, 2026-08-30. Reviewed cleaner's `c2b36bf2c4` (merge of coder's
`e29af64cf7`, which fixes D1 from the prior bounce).

## D1 verified fixed

`extension/test/bl1277StepCollisionInvariants.property.test.js` line ~120 now
uses the `\0` escape sequence, with a comment against regression. Confirmed:
`file` reports the file as UTF-8 text (not `data`); a byte-level scan of the
file finds no raw `0x00`; `git diff`/`git show` on the coder's fix commit
render as a normal text diff. Also scanned every other file this parcel
touches (the coder's own stated scope: "every file in this parcel and in
BL-1279's and BL-1280's") for a raw NUL — none found.

The coder's remediation is the correct one per BL-490/BL-1213: a real revert
of the accepted bounce-revert commit (`ac6ab4bbb7`), not a checkout that
restores bytes with no commit to attribute them to.

## A merge-drop caught and fixed during THIS merge (not a coder/cleaner defect)

Merging cleaner's `c2b36bf2c4` into this branch resolved
`specs/pipeline/steps/index.js` with NO conflict, but the result silently
dropped `require('./bl1277UnscopedStepCollisionSteps')`. Root cause: the
merge-base (`6259b0b9e`) had the line; my side (this branch, after my earlier
bounce-revert) had removed it; their side had it present but unchanged
relative to a DIFFERENT ancestor in their history — so git's three-way merge
read it as "one side modified (deleted), other side unchanged" and followed
the deletion with no conflict marker. Per the standing guidance to diff every
merge against both parents: diffing my merge commit against `c2b36bf2c4`
directly showed this was the ONLY discrepancy. Restored the require line and
committed (`82d54927f`) before doing anything else.

## Checks re-run after the fix, all clean

- `npx vitest run test/bl1277UnscopedStepCollisionGuard.test.js`: 6/6.
- `npm run test:properties -- bl1277`: 5/5.
- `node specs/pipeline/cli.js specs/features/BL-1277-...feature`: 5/5.
- `BL-1268-stale-claim-branch-must-name-this-ticket.feature`: 7/7.
- `BL-378-no-single-file-bounds-the-suite.feature`: 4/4.
- `node extension/out/tools/dependency-gate.js` (parcel files + full-repo):
  PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js`: only this ticket's own
  files co-change (3x, one per round-trip); no external coupling.

No further defect. Forwarding to hardener.
