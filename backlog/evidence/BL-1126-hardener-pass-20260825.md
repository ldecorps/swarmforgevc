# BL-1126 — hardener pass — 2026-08-25

Architect tip: `0e0dfe1580` on 1126-only cleaner tip `f2394e59b6` (20 product
paths vs `origin/main`). Recreated `swarmforge-hardender` on tip (cleared
conflicting untracked `local_agent/` scratch first).

## Scope

- `swarmforge/scripts/local_agent/{agent_core,turn_gate,socket_deadline,server}.py`
- Unit suite + APS feature

## Gates

| Check | Result |
|---|---|
| Unit (`unittest` local_agent) | **17/17 OK** |
| Acceptance | **4/4** |
| Cyclomatic complexity | all helpers **≤ 6** |
| Gherkin soft | **inapplicable** (`total=0`) |
| Surgical Python mutants | **8/8 killed** |

### Surgical detail

1–2. `arm_connection_deadline` / `cancel_deadline` disable/noop  
3–4. `TurnGate.raise_if_stale` / `raise_if_aborted` never-fire  
5–6. `fast_path_reply` / `_soft_liveness_hit` rename-off  
7–8. `_recover_empty_reply` nudge never/always; `deadline_exceeded` always-false / invert

## CRAP / Stryker TS

N/A — Python parcel.

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1126-local-agent-telegram-turn-reliability`, commit = this tip.

By hardener.
