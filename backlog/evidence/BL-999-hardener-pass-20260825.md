# BL-999 hardener pass — 20260825

**Architect tip:** `5a9e083d70`
**Task:** `BL-999-a-test-budget-is-justified-not-merely-present`

## Tip purity

`git reset --hard origin/main` → merge tip-pure architect.
`origin/main...HEAD` → **8 paths**, **0 deletes** (pre-evidence).

## Product surface

Shared measurement table + `budgetMs >= ceil(worstMs * 1.6)` in
`extension/test/renderBriefingBurndownCli.budgets.js`. Fixture paths
carry recorded margin decisions vs suite default. Authorize **BL-999
paths only**.

## Hardener deltas

Soft Gherkin stamped the feature (`outcome: inapplicable`). Surgical
mutants on budgets module (margin, comparison, filter, suite default,
worstMs understatement).

## Gates

| Gate | Result |
|------|--------|
| vitest bl999 + renderBriefingBurndownCli | 3/3 + 5/5 |
| APS BL-999 feature | 4/4 |
| Soft Gherkin | `outcome: inapplicable` — no Outline; not a pass |
| Surgical (6) | killed=6 survived=0 skipped=0 |

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-999 only.

By hardender.
