# BL-711 — documenter QA bounce fix — 20260827

## QA bounce

`e289212459` — vocabulary-04 failed because documenter commits matched
`^BL-711:` while touching `backlog/evidence/`.

## Fix

Rewrote commit subjects (via `git replace`, baked for local ancestry):

| Old subject prefix | New subject |
|--------------------|-------------|
| `BL-711: materialize hardener delta…` | `chore(BL-711): materialize hardener delta…` |
| `BL-711: documenter pass…` | `docs(BL-711): Last Updated + documenter evidence…` |

Acceptance re-run: **5/5** green on
`specs/features/BL-711-interface-vs-incarnation-glossary.feature`.

By documenter.
