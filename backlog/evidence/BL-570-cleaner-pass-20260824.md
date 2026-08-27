# BL-570 cleaner pass — 2026-08-24

## Inbound

Coder tip `43e56446b0` ancestry vs `origin/main` was hitchhiked (INTAKE /
done/M8 / …). Tip commit surface alone is BL-570-only (11 paths).

Cleaner recreated `swarmforge-cleaner` on `origin/main` and cherry-picked
`43e56446b0` (hitchhike-free rematch tip). Did **not** merge the dirty tip
ancestry.

Hitchhike gate:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN.

## Checks run

1. **Unit** — `bash swarmforge/scripts/test/test_property_suite_drift_guard.sh`:
   ALL PASS (7 cases).
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-570-property-suite-drift-guard.feature`:
   7/7 pass. Required wiring: steps in `index.js`; pre-commit calls the
   guard script.
3. Did **not** run live `npm run test:properties` (coder land note:
   that lane previously renamed `swarmforge-coder`→`main`).

## Cleanup performed

NONE on scripts/steps — already thin (path trigger + injectable suite).

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-570-property-suite-drift-guard`.

By cleaner.
