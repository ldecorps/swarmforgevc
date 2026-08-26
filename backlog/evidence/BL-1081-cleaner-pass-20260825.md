# BL-1081 cleaner pass — 2026-08-25

## Inbound

Coder tip `4b533c0a7b` — re-entry after unhold; APS baseline adds
`local-model` to `WAKE_STYLE_BEFORE_ACP`. Rematched **1081-only** onto
`origin/main` = `7e430470c0` (not stacked on BL-1115). Hitchhike gate
clean of `hotfix-ledger` / INTAKE / `done/M8`.

## Checks run

1. Gherkin — `BL-1081-an-acp-host-in-a-pane-can-drive-one-seat.feature` — 5/5

## Cleanup performed

NONE — one-line provider-table baseline align; product already on main.

## Forward

`git_handoff` to architect, priority 50, task
`BL-1081-an-acp-host-in-a-pane-can-drive-one-seat`.

By cleaner.
