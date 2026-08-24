# BL-1100 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `7aaf51f70f` (drop prose do-not-promote grep; structured
epic/blocked skips announce id+gate; BL-553/BL-828 status: blocked) into
`swarmforge-cleaner` via `git merge --no-ff`.
Ancestry: `git merge-base --is-ancestor 7aaf51f70f HEAD`.

## Checks run

1. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1100-promotion-candidacy-is-decided-by-structured-fields-never-prose.feature`:
   8/8 pass.
2. **Property** —
   `npx vitest run --config vitest.properties.config.mjs test/bl1100PromotionProseNeverBlocks.property.test.js`:
   2/2 pass.

## Cleanup performed

- `is_buildable` reuses `ticket_id_of` instead of a second id-grep/awk.

## Findings beyond that

NONE. `is_do_not_promote` is gone; `--list-candidates` announces structured
skips; parked prose for BL-553/BL-556/BL-828 remains verbatim behind
`status: blocked`.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1100-promotion-candidacy-is-decided-by-structured-fields-never-prose`.

By cleaner.
