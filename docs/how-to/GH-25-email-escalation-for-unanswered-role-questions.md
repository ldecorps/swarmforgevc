# Email escalation for unanswered role questions (GH-25)

A clarifying question raised with `role_ask.bb` (BL-607 / BL-773) that sits
unanswered past a threshold must still reach you by email — even if it never
landed in Telegram. The operator runtime tick scans
`.swarmforge/operator/role-awaiting/*.json`, escalates **once**, and stamps
`escalated_at_ms` so later ticks stay silent.

Transport is a GitHub issue comment mentioning `@ldecorps` on a dedicated ops
issue (cached GitHub creds). GitHub sends the notification email — no new
SMTP secrets. Plain SMTP is out of scope until requested.

This is the safety net **above** GH-26 (undeliverable-drop wedge), not a
substitute for fixing undeliverable asks.

## Configure

In `swarmforge/swarmforge.conf` (commented defaults) or env:

| Knob | Env override | Default | Role |
|---|---|---|---|
| Ops issue number | `SWARMFORGE_ASK_ESCALATION_ISSUE` | unset | Issue that receives the `@ldecorps` comment |
| Threshold (minutes) | `SWARMFORGE_ASK_ESCALATION_MINUTES` | `30` | Age since `asked_at_ms` before escalate |

Conf keys (when uncommented):

```text
config ask_escalation_issue <N>
config ask_escalation_minutes 30
```

(`ask_escalation_issue` is read from conf when the env override is absent.
Threshold minutes are taken from `SWARMFORGE_ASK_ESCALATION_MINUTES`, else
default 30.)

**Missing / bad ops issue:** no crash. The tick logs a warning, leaves markers
unstamped, and surfaces `ask_escalation.transport: unconfigured` in
`status.json`.

## What you see

1. After the threshold, one GitHub comment on the ops issue naming the role
   and question text.
2. The role's awaiting marker gains `escalated_at_ms` — no second comment on
   later ticks.
3. Operator `status.json` carries:
   - `role_questions.<role>.state`: `pending` or `escalated`
   - `ask_escalation.transport`: configured vs `unconfigured`

## Operator check

```bash
# See pending / escalated ask surface
jq '.role_questions, .ask_escalation' .swarmforge/operator/status.json

# Synthetic overdue marker (live swarm): back-date asked_at_ms, omit escalated_at_ms,
# wait one operator tick, confirm one GH comment + stamp; next tick silent.
```

## Related

- [Coordinator `role_ask.bb`](BL-773-coordinator-role-ask-clarifying-question.md) — how asks are raised.
- [Stale approval-ask email escalation](BL-584-stale-approval-ask-email-escalation.md) — Approvals topic, different path.

Acceptance: `specs/features/GH-25-role-ask-email-escalation.feature`.
