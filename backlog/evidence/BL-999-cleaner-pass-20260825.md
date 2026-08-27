# BL-999 — cleaner pass — 20260825

- Tip-pure cherry-pick coder `2ee476dd15` onto `origin/main` only
  (`dels_on_origin=0`).
- DRY: shared `classifyBurndownCliTests` in budgets module; APS + invariant
  tests consume it; drop unused APS INVARIANT path.
- `vitest run test/bl999BudgetJustificationInvariant.test.js` — 3/3 pass.

By cleaner.
