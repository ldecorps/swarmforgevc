# BL-1126 cleaner bounce — pycache / tip-only — 2026-08-25

## Architect note

`BL-1126 bounce: drop __pycache__; tip must be 1126-only`

## Action

1. Abandoned stacked tip `b2ce75feb9` (kept in objects/reflog).
2. Reset `swarmforge-cleaner` to `origin/main` (`be3a93e47e`).
3. Cherry-picked coder tip `5b9c255238` → hitchhike CLEAN, BL-1126-only paths.
4. Restored cleaner CC≤6 extracts for `local_agent/` (no `__pycache__` tracked).

## Checks

`python3 -m unittest` (4 suites) — 17 OK.
AST CC scan — all functions ≤ 6.
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'` → CLEAN.
No `__pycache__` / `*.pyc` in tip tree.

## Forward

`git_handoff` to `architect`, tip abbrev below.

By cleaner.
