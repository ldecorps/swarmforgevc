# BL-980 cleaner pass — rematch8 — 2026-08-27

## Inbound

`merge_and_process coder a2f216e932` — already ancestor of
`swarmforge-cleaner` HEAD (no merge commit needed). Re-forward after architect
hitchhike bounce; land-pure implementation tip unchanged.

## Checks run

1. **Compile** — `npm run compile` in `extension/`: PASS.
2. **Unit** — `vitest run test/bl980RecentlyClosedElapsed.test.js`: 7/7 PASS.
3. **Property** — `vitest run --config vitest.properties.config.mjs test/bl980RecentlyClosedElapsed.property.test.js`: 2/2 PASS.
4. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-980-recently-closed-elapsed-time.feature`:
   15/15 pass.

## Cleanup performed

NONE. `formatRecentlyClosedAgeLabel` is already extracted; ladder differs from
other relative-time formatters per ticket (intentional separate surface).

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-980-recently-closed-elapsed-time`, commit **`a2f216e932`** (land-pure tip —
no cleaner-branch hitchhikers in the forwarded hash).

By cleaner.
