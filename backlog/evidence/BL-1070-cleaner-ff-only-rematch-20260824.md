# BL-1070 cleaner rematch (FF-only tip af2a853d9b) — 2026-08-24

## Inbound

Architect bounce `3f7895b5d9` (D1 hitchhike): rematch tip `0ac6f8713b`
merged clean coder tip into dirty cleaner ancestry. Close-by: forward
`af2a853d9b` hitchhike-free.

Cleaner recreated `swarmforge-cleaner` on `af2a853d9b`
(`git checkout -B swarmforge-cleaner af2a853d9b`). Did **not** merge the
bounce tip (evidence copied as a file only).

Hitchhike gate:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN.

Also acknowledged same-batch coder note: BL-1112 tip `7a70c99207` FF-only
(already applied earlier this turn as `f9788edff3`).

## Checks run

1. **Unit** — `bb …/agent_process_marker_lib_test_runner.bb`: OK.
2. **Gherkin acceptance** — BL-1070 feature: **9/9**.

## Cleanup performed

Branch recreation onto hitchhike-free tip only.

## Findings beyond that

NONE. Inventory item D1 closed.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1070-pane-liveness-misses-a-claude-below-the-first-generation`.

By cleaner.
