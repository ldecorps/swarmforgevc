# BL-1090 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `537bb54dea` (shared `approvalAskRecordedOnLiveTopic`;
edge path suppresses re-post when ask already on live Approvals topic and
catches up `emittedKeys`) into `swarmforge-cleaner` via `git merge --no-ff`.
Ancestry: `git merge-base --is-ancestor 537bb54dea HEAD`.

## Checks run

1. **Extension unit** — `npx vitest run test/approvalAskReconcile.test.js
   test/conciergeTick.test.js` (after `npm run compile`): 120/120 pass.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1090-a-lost-tick-baseline-reposts-an-exact-duplicate-approval-ask.feature`:
   6/6 pass.

## Cleanup performed

- `approvalAskReconcile.ts`: remint branch is “any recorded ask not already
  live” (redundant `topicId !== live` dropped after the shared predicate).
- `conciergeTick.ts`: edge suppress uses an explicit loop instead of a
  `filter` with side effects on `alreadyEmitted`.
- `bl1090LostTickBaselineDuplicateAskSteps.js`: ask-location phrases via
  `ASK_BY_LOCATION` lookup.

## Findings beyond that

NONE. Remint (stale topicId) still re-posts; live-topic asks stay suppressed
on both reconcile and edge paths.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1090-a-lost-tick-baseline-reposts-an-exact-duplicate-approval-ask`.

By cleaner.
