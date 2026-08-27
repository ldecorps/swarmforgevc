# BL-1166 — cleaner pass (APS rematch) — 20260827

## Inbound

Coder tip `57cfbf2d8e` lagged `origin/main`. Tip-pure cherry-pick onto
current `origin/main` → `e48ed5a52`, plus alias cleanup.

## Checks run

1. **Tip purity** — BL-1166-only.
2. **Compile** — PASS.
3. **Unit** — `operatorDocsCore.test.js`: 7/7 PASS.
4. **Property** — `operatorDocsReadOnly.property.test.js`: 1/1 PASS.
5. **Dep-gate** (operatorDocsCore + operatorDocsHtml) — PASSED.

## Cleanup performed

- Removed `isOperatorDocsIndexFeedPath` / `isOperatorDocsPageFeedPath`
  wrappers; wire imported path predicates directly.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1166-bubble-authored-docs-index-and-first-pages`.

By cleaner.
