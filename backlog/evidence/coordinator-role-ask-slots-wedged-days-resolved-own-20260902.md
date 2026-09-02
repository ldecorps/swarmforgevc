# role_ask slots wedged for days — coordinator resolved its own; specifier told how — 2026-09-02 18:13 UTC

## Trigger
Specifier `note` (priority `00`): "specifier role_ask held 3d by unanswered
08-30 drift Q; needs human".

## Facts (from `.swarmforge/operator/role-awaiting/`)
- `specifier.json` — asked 2026-08-30 17:18Z: the worktree-drift-storm
  question (nine drift stashes, commit `44d2d42591`). ~3 days pending.
- `coordinator.json` — asked 2026-08-31 03:13Z (`asked_at_ms 1788142427756`):
  the BL-1300 `backlog/hold/` ruling (option 1 confirm-live-and-close /
  option 2 revert-and-rebuild-at-42000 / move back to paused). ~2.6 days
  pending. No answer trace in any operator store; only the posted Telegram
  message record (`telegram-ask-messages.json` `role-ask-coordinator`,
  msg 64916). GH-25 escalates any ask unanswered >30 min to the human via
  GitHub mention, so both have long since been surfaced.
- Consequence today: my two attempts to escalate the specifier outage via
  `role_ask` (13:48 and 17:33) were refused `already-pending`. The
  specifier's channel was equally blocked for its BL-1338/BL-1340/BL-1341
  adjudications.

## Mechanism the note missed
`role_ask.bb` has a BL-1245 resolve verb:
`role_ask.bb <root> --role <role> --resolve --reason <why>` — the ASKING
ROLE reopens its own slot when the answer never reached the store. The
question is preserved to `role-awaiting-archive/<role>-<asked_at_ms>.json`
with the reason; the live marker is removed. Precedent in the archive:
`coordinator-BL1237-moot-20260829T0619Z.json`. It does not need the human.

## Actions
- Resolved my own slot (`resolved: true`, archived
  `coordinator-1788142427756.json`) with reason: unanswered 2.6 d, no
  answer paired, BL-1300 ruling still owed and durable in
  `backlog/hold/BL-1300-the-headroom-proof-is-a-permanent-hidden-budget.yaml`,
  slot needed for live escalations.
- Sent the specifier a `note` (priority `00`) with the self-clear recipe;
  I did not and must not resolve another role's slot. The drift-storm
  question it asked is, per operator memory, already handled (the 08-30
  storm and its 08-31 recurrence were cleaned up), so resolving it as
  moot is reasonable — the specifier's call.
- Completed the note task.

## Still owed by the human (unchanged, restated so it is not lost)
BL-1300 sits in `backlog/hold/` (Article 3.1: only a human moves it).
Ruling needed: option 1 (confirm the already-live fix on main and close)
or option 2 (revert, then rebuild at 42000), or move it back to `paused/`
so the normal approval ask re-fires.

By coordinator.
