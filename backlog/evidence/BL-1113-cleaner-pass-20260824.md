# BL-1113 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `46a9cf02ad` (BL-1113 stamp-off harness for Cursor
hotfix `27273f2b0a`) into `swarmforge-cleaner` via `git merge --no-ff`
(ancestry confirmed: `git merge-base --is-ancestor 46a9cf02ad HEAD`).

Parcel surface (coder tip alone):
- `specs/pipeline/steps/bl1113CursorHotfixStampOffSteps.js` (new)
- `specs/pipeline/steps/index.js` (register wiring)
- `extension/test/bl1113CursorHotfixStampOff.property.test.js` (new; not owned
  by cleaner — left untouched)

## Checks run

1. **Hotfix blob identity** — all six landed paths in the property-test
   allowlist still match `27273f2b0a` (`git diff --quiet` each). Stamp-off
   did not rewrite the hotfix.
2. **Babashka unit** — `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb`:
   ALL TESTS PASS. (CRAP/mutation/DRY not wired for `.bb` — degraded gate
   per Engineering Rules.)
3. **Extension unit** — `npx vitest run test/pipelineBoard.test.js
   test/telegramCursorOperatorCore.test.js test/telegramCursorBridgeLive.test.js`:
   254/254 pass.
4. **Gherkin acceptance** — `node specs/pipeline/cli.js
   specs/features/BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off.feature`:
   9/9 pass (status matrix, deadlock suppress, cursor-forge pack, board
   slug/nbsp, CreatePlan Confirm/Reject).

Property suite not run (cleaner does not own property tests). Mutation-site
count N/A — no TS `src/` files changed by this parcel.

## Cleanup review (Cleanup Order)

- **Coverage** — harness drives the real landed APIs
  (`sync-action` / deadlock helpers, `cursor-forge.conf`,
  `deriveKebabSlug` + `wrapPipelineBoardHtml`, `planConfirmButtons` +
  `writePendingPlanConfirm`); no uncovered new production behavior in this
  parcel.
- **CRAP / DRY / mutation tooling** — no new TS production modules; `.bb`
  surface gated by unit suite only (ran above). APS/property files are
  outside cleaner ownership.
- **Module structure** — step module keeps load-time to requires + pure
  constants (BL-968), locks Examples tables in `EXPECTED_*`, and calls real
  libs rather than reimplementing the hotfix. Separation matches prior
  stamp-off harnesses (e.g. BL-848/BL-1108). No split or boundary fix
  needed.
- **Duplication** — two small `fs.rmSync` finally blocks are intentional
  per-scenario fixture teardown; extracting them would not improve SoC.
  `os.tmpdir()` fixtures match prevailing APS step convention.

## Findings

NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1113-cursor-hotfix-main-sync-board-plan-stamp-off`.

By cleaner.
