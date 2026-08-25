# BL-1107 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `4579fe124d` (enumerate bl796 invariants 2–3 by
construction; 120s timeout; spawn ≤ space size) into `swarmforge-cleaner`
via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 4579fe124d HEAD`.

## Checks run

1. **Property** —
   `npx vitest run --config vitest.properties.config.mjs test/bl796NvmNodePathFollowUpAdoptInvariants.property.test.js`:
   3/3 pass.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1107-property-lane-verdict-turns-on-host-load-not-code.feature`:
   5/5 pass.

## Cleanup performed

- Extracted `cartesianCases` so invariants 2 and 3 share one product builder
  instead of duplicated nested loops.

## Findings beyond that

NONE. Coverage is by construction; spawn counts stay ≤ space size; lane
default 20s is unchanged (tests carry their own 120s override).

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1107-property-lane-verdict-turns-on-host-load-not-code`.

By cleaner.
