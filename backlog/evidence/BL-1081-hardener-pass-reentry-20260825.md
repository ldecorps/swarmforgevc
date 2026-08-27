# BL-1081 — hardener pass (re-entry) — 2026-08-25

Architect tip: `5a5ed7e392` on cleaner re-entry `79dbcdbfe9` (1081-only on
`origin/main`). Recreated `swarmforge-hardender` on tip. BL-506: **BL-1081
paths only**. Product already on main; delta is APS wake-style baseline for
`local-model`.

## Gates

| Check | Result |
|---|---|
| Acceptance | **5/5** |
| Properties (3 files) | **3/3** |
| Gherkin soft | **inapplicable** (`total=0`) |
| Surgical APS mutants | **3/3 killed** |
| Production CRAP/Stryker | N/A (no TS product change this hop) |

### Surgical detail

1. Drop `'local-model': 'chat-message'` from `WAKE_STYLE_BEFORE_ACP`  
2. Map to `'mock'`  
3. Map to `'prompt'`  

All fail acceptance scenario 05 (provider table dimension).

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1081-an-acp-host-in-a-pane-can-drive-one-seat`, commit = this tip.

By hardener.
