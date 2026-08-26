# BL-1115 — hardener pass — 2026-08-25

Architect tip: `1bde7d3f81` (1115-only rematch). Recreated
`swarmforge-hardender` on tip. Authorize **BL-1115 paths** (BL-506).

## Gates

| Check | Result |
|---|---|
| Hotfix blob `a3bf11b533` vs `main_sync_status_cli.bb` | **MATCH** |
| Property stamp-off (2) | **2/2** |
| Acceptance | **7/7** |
| Gherkin soft | Outline Example cell twins remain equivalents (Given+Then share cell); APS hardened |
| Surgical CLI | **2/2 killed** (invert `[behind ahead]` binding; invert `origin/main...main` range) |

### APS harden

Outline Given/Then refuse negative Example cells; deadlock capture is
`\S+` + allowlist (kills `cleaR`); fixture self-checks `rev-list` geometry
before trusting CLI output.

## CRAP / Stryker TS

N/A — stamp-off / Babashka CLI; no new production TS module.

## Ledger

`a3bf11b533` remains `state: pending` / `human_decision: null` (invariant 2).

## Forward

`git_handoff` → `documenter`, priority `00`, task
`BL-1115-swarm-stamp-main-sync-status-cli-ahead-behind-swap`, commit = this tip.

By hardener.
