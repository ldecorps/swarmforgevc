# BL-1070 — hardender pass (FF-only rematch) — 20260824

## Inbound

Architect tip `e2c691b504`. Per FF-only instruction: **recreated**
`swarmforge-hardender` on that tip — did **not** merge into hitchhiked
ancestry (and did not stack onto the concurrent BL-1112 FF tip).

Hitchhike gate before handoff:
`git diff --name-only origin/main...HEAD | rg 'acpHostClient|hotfix-ledger|^backlog/INTAKE-|done/M8'`
→ CLEAN.

## Scope

Pane-tree descendant liveness already on tip (`descendant-pid-set` BFS).
Docs rematch content included. No code delta this pass beyond evidence.

## Host / cooldown

| File | Decision |
|---|---|
| `agent_process_marker_lib.bb` | **skip-cooldown** |

## Hand-authored surgical (reconfirm)

| Mutant | Result |
|---|---|
| direct-child-only descendant set | killed |
| match any claude globally | killed |
| empty under-pane set | killed |
| never match marker | killed |

Survivors: 0.

## Verification

- Acceptance **9/9**
- `agent_process_marker_lib_test_runner` OK

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `documenter`, priority `00`, task
`BL-1070-pane-liveness-misses-a-claude-below-the-first-generation`.

Documenter: recreate on this tip; do not merge into hitchhiked ancestry.

By hardender.
