# BL-710 — documenter pass — 20260827

## Inbound

Hardener tip `01e7a5d636`. Merge ancestry recorded on `swarmforge-documenter`.
Task `BL-710-one-clear-telegram-redeploy-path`.

## Living docs updated

| Doc | Change |
|-----|--------|
| `docs/how-to/BL-698-telegram-cursor-operator-commands.md` | New § Redeploy forms — `/redeploy`, `/redeploy miniapp`, `/redeploy frontdesk`, `/redeploy all` |
| `docs/reference/specs/BL-698-telegram-cursor-operator-command-surface.md` | Command map rows for frontdesk + all |
| `docs/reference/specs/BL-696-amendment-telegram-operator-commands.md` | Table + implementation map |
| `docs/how-to/BL-702-operator-confirm-env-reload.md` | Soft-tier + env-reload lists include all redeploy forms |
| `docs/diagrams/operator-command-surface.mmd` | Soft subgraph label |
| `docs/reference/Specification.MD` | Last Updated entry |

## Pipeline wiring

Registered `bl710OneClearTelegramRedeployPathSteps` in `specs/pipeline/steps/index.js`
(surgical add only — no hitchhiker index churn).

## Pre-QA

Ticket acceptance resolves to
`specs/features/BL-710-one-clear-telegram-redeploy-path.feature` (present from
hardener materialization).

By documenter.
