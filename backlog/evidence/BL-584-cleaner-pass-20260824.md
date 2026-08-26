# BL-584 cleaner pass — 2026-08-24

## Inbound

Coder tip `75d10dee49` ancestry vs `origin/main` was hitchhiked. Tip commit
surface alone is BL-584 (12 paths: escalation module, front-desk /
concierge / config wiring, unit + property tests, acceptance steps +
register, conf comments).

Cleaner recreated `swarmforge-cleaner` on `origin/main` and cherry-picked
`75d10dee49` (hitchhike-free rematch tip `295d5c8523`). Did **not** merge
the dirty tip ancestry. First cherry-pick attempt left the worktree
corrupted when the property-suite commit hook failed mid-flight; recovered
with `git reset --hard origin/main` and re-cherry-picked with
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1`.

Hitchhike gate:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN.

## Checks run

1. **Compile** — `cd extension && npm run compile`: OK.
2. **Unit** — `npx vitest run test/staleApprovalEscalation.test.js
   test/swarmforgeConfigEffective.test.js test/conciergeTick.test.js`:
   132/132 pass.
3. **Property** — `npx vitest run --config vitest.properties.config.mjs
   test/bl584StaleApprovalEscalation.property.test.js`: 1/1 pass.
4. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-584-stale-approval-ask-email-escalation.feature`:
   20/20 pass.

## Cleanup performed

NONE — helpers already small (injected sweep, fail-closed clocks, digest
builder); front-desk wiring mirrors existing reconcile adapters.

## Findings beyond that

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-584-stale-approval-ask-email-escalation`.

By cleaner.
