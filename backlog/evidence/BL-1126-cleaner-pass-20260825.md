# BL-1126 cleaner pass — 2026-08-25

## Inbound

Coder tip `5b9c255238` — hitchhike CLEAN vs `origin/main`. Stacked onto
cleaner tip `861cd347b9`. Conflicts in steps index, architecture.mmd,
docs/index.md, Specification.MD resolved keeping all stacked tickets.
Tip after cherry-pick: `aaa67d93a`.

## Checks run

`python3 -m unittest` in `swarmforge/scripts/local_agent/` —
`test_socket_deadline`, `test_turn_gate_abort`, `test_empty_reply_recovery`,
`test_agent_core_hang_guards` — 17 OK.

Rough AST cyclomatic scan: all functions in agent_core/server/turn_gate/
socket_deadline ≤ 6 after cleanup.

## Cleanup performed

Extracted helpers to keep CC ≤ 6 on turn paths:
- agent_core: fast-path/soft-liveness, deadline emit, chat-error,
  finalize/tool-call, quick/real turn bootstrap
- server: `_run_locked_turn`, `_parse_turn_request`, `_write_stream_error`
- socket_deadline: module-level `_fire_deadline` / `_shutdown_conn`

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1126-local-agent-telegram-turn-reliability`.

By cleaner.
