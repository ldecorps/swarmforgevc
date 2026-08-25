# BL-534 cleaner pass — 2026-08-25

## Inbound

Coder tip `29dc3d83f8` ancestry vs `origin/main` was hitchhiked. Tip commit
surface alone is BL-534-only (8 paths).

Cleaner recreated `swarmforge-cleaner` on `origin/main` and cherry-picked
`29dc3d83f8` (hitchhike-free rematch tip `d833e7fb74`). Resolved
`specs/pipeline/steps/index.js` to register only
`bl534ThinMainCrapVisibleCliGateSteps` (dropped hitchhiked `bl626` require).
Did **not** merge the dirty tip ancestry.

First cherry-pick continue ran the pre-commit property-suite guard; fixture
git commits rewrote `swarmforge-cleaner` HEAD (same class as coder tip note).
Recovered via `git reset --hard origin/main`, re-cherry-picked with
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1`.

Hitchhike gate:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN.

## Checks run

1. **Compile** — `cd extension && npm run compile`: OK.
2. **Unit** — `npx vitest run test/thinMainGate.test.js`: 9/9 pass.
3. **Property (scoped)** —
   `npx vitest run --config vitest.properties.config.mjs test/thinMainGate.property.test.js`:
   2/2 pass.
4. **Dogfood** — `node out/tools/thin-main-gate.js out/tools/thin-main-gate.js`
   exit 0.
5. **Mutation-site count** — thinMainGate.ts / thin-main-gate.ts: 0 sites,
   within.

## Cleanup performed

- `thinMainGate.ts`: extract `decisionPointDelta` so visit stays CC-bounded.
- `thin-main-gate.ts`: shared `isPathUnder`; drop unused ALLOWLIST_PATH /
  isUnderTools void hacks; single allowlist basename constant.
- `bl534ThinMainCrapVisibleCliGateSteps.js`: remove dead unused `runGate`.

## Findings beyond that

Feature file `specs/features/BL-534-thin-main-crap-visible-cli-gate.feature`
exists on coder (`918d6d6f3`) but was **not** in tip `29dc3d83f8`. Cleaner
did not invent Gherkin. Architect/specifier may need to land that surface
with the parcel.

Ticket YAML remains in `backlog/paused/` on this tree.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-534-thin-main-crap-visible-cli-gate`.

By cleaner.
