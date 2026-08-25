# BL-999 — architect pass — 20260825

**Tip:** cleaner `3c67efc83b` (coder `fb931192a8`)
**Handoff:** `00_20260825T185643Z_000857_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

`origin/main...3c67efc83b` = **7 paths**, **0 deletes** (tip-pure reset).
Authorize BL-999 paths only.

## Architecture

- Root cause: BL-969 guard asserted budget *presence*; siblings kept
  `45000` while field data already exceeded it (`48926ms` @ load 77).
- Fix: shared measurement table + `budget >= ceil(worst×1.6)` relation;
  three real-repo tests share `90000`; fixture tests keep suite default
  with recorded margin decisions; classification still code-token markers
  (`writeFixtureSnapshot(` / `'--snapshot'`).
- Cleaner DRY: `classifyBurndownCliTests` shared by invariant + APS.
- Suite default untouched (`vitest.config.mjs` diff empty). Does not amend BL-969.

## Verification

| Check | Result |
|-------|--------|
| `bl999BudgetJustificationInvariant.test.js` | 3/3 pass |
| `bl969RealRepoTimeoutInvariant.test.js` | 1/1 pass |
| APS BL-999 feature | 4/4 pass |
| `extension/vitest.config.mjs` vs origin/main | empty |
| Tip deletes | 0 |
| Host load at verify | ~5.0 (quiet; sibling flake basis is recorded field data) |

By architect.
