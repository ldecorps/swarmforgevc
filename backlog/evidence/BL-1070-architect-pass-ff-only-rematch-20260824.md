# BL-1070 — architect pass (FF-only rematch) — 20260824

## Review inventory (Article 4.4)

NONE. Prior D1 (cleaner hitchhike on `0ac6f8713b`) closed by tip
`e253dda292` / `af2a853d9b`.

## Inbound

Cleaner rematch tip `e253dda292` (FF-only on hitchhike-free coder tip
`af2a853d9b`). Architect **recreated** `swarmforge-architect` on this tip
— did **not** merge into prior local ancestry.

Hitchhike gate:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN (19 paths, BL-1070 surface + evidence only).

## Architecture

Prior pass still holds: `agent-process-line` walks all `ps` descendants of
the pane (BFS via ppid); never matches outside the pane tree; RC check
emits UNAVAILABLE when liveness gate unmet; BL-802 gather-failed path
intact.

## Gates

| Gate | Result |
|---|---|
| Unit (`agent_process_marker_lib_test_runner.bb`) | OK |
| Acceptance (BL-1070) | **9/9** |
| Stamp-off (BL-1113) | **9/9** |

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `hardender`, priority `00`, task
`BL-1070-pane-liveness-misses-a-claude-below-the-first-generation`.

Hardender (and every later role): **recreate** the role branch on this tip;
do **not** `git merge` into hitchhiked ancestry. Re-check the hitchhike gate
before handing off.

By architect.
