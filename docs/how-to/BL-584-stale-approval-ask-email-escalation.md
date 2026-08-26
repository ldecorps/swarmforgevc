# Stale approval-ask email escalation (BL-584)

## The gap

An Approvals-topic ask (`ApprovalRequested`) can sit forever if the Telegram
notification is missed. Nothing else nudged the human, so
`human_approval: pending` (or `amending`) blocked dependents silently.

## What changed

On each front-desk concierge tick, `staleApprovalEscalation.ts` sweeps live
tickets in `active/` and `paused/`:

| Rule | Behaviour |
| --- | --- |
| States | Only `pending` / `amending` |
| Clock | Latest Approvals-ask outbound `ts` in `backlog/topics/<id>.json`; reset by **inbound** human messages only |
| Missing clock | Fail closed → not stale |
| Email shape | One digest, oldest-first; each line has a `t.me/c/…` deep link to that ask |
| Threshold | Default 2h (`approval_ask_stale_after_ms`) |
| Cooldown | Default 4h global (`approval_ask_email_cooldown_ms`); state in `.swarmforge/operator/stale-approval-escalation.json` |
| Send order | Cooldown file written **before** `sendEmail` (no storm if send throws) |

Conf keys are commented defaults in `swarmforge/swarmforge.conf` (no live
duplicate that can drift). Depends on BL-582: a broken Approve tap would
otherwise escalate asks you already decided.

## Operator note

Tune the two conf keys if 2h/4h is wrong for your hours. Opening a deep link
jumps to that message in the Approvals topic so you can act from the email.

Acceptance:
`specs/features/BL-584-stale-approval-ask-email-escalation.feature`
