# BL-1166 — cleaner pass — 20260827

## Inbound

Coder tip `7700fa210d` (parent lagged `origin/main`). Tip-pure cherry-pick onto
current `origin/main` → `729960e36` (9 paths, `dels=0`).

## Checks run

1. **Tip purity** — BL-1166-only; `dels=0`.
2. **Compile** — PASS.
3. **Unit** — `operatorDocsCore.test.js`: 7/7 PASS.
4. **Property** — `operatorDocsReadOnly.property.test.js`: 1/1 PASS.
5. **DRY** — 0 clones on core/html modules.
6. **Dep-gate** (operatorDocsCore + operatorDocsHtml) — PASSED.

## Cleanup performed

NONE. Core (parse/render/guards) vs Html (shell/JSON builders) already split;
bridge wiring stays thin.

## Findings

NONE. Inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1166-bubble-authored-docs-index-and-first-pages`.

By cleaner.
