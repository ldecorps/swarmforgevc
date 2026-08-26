# BL-1091 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `3d59989362` (pathspec-commit both ends of an Expedite
paused→active rename) into `swarmforge-cleaner` via `git merge --no-ff`.
Ancestry: `git merge-base --is-ancestor 3d59989362 HEAD`.

## Checks run

1. **Property** —
   `npx vitest run --config vitest.properties.config.mjs test/bl1091ExpeditePromotionCommit.property.test.js`:
   2/2 pass.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1091-expedite-commits-only-half-of-the-promotion-move.feature`:
   6/6 pass (rename both-ends + already-active + 4 in-place writer rows).

## Cleanup performed

- Deduped the doubled BL-892/BL-1091 comment on `commitApprovalWrites`.
- Extracted `uniqueRelPaths` so destination + rename-source staging share one
  relative-path gather (no inline for-loop in the public API).

## Findings beyond that

NONE. `BacklogMoveResult.source` flows through `PromotionOutcome` /
`commitExpediteWrites`; in-place Approve/Reject/Amend still pass no extras.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1091-expedite-commits-only-half-of-the-promotion-move`.

By cleaner.
