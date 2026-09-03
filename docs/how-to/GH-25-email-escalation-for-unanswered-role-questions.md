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

**Missing / bad ops issue:** no crash. The tick leaves markers unstamped and
surfaces `ask_escalation.transport: unconfigured` in `status.json` — see
"Transport visibility (BL-1352)" below for how that degradation is now
reported.

## What you see

1. After the threshold, one GitHub comment on the ops issue naming the role
   and question text.
2. The role's awaiting marker gains `escalated_at_ms` — no second comment on
   later ticks.
3. Operator `status.json` carries:
   - `role_questions.<role>.state`: `pending` or `escalated`
   - `ask_escalation.transport`: configured vs `unconfigured`
   - `ask_escalation.state`/`ask_escalation.detail`/`ask_escalation.waiting_roles`
     — the human-facing health, see below.

## Transport visibility (BL-1352)

GH-25 shipped with this degradation path invisible: an unconfigured
transport wrote only `status.json` and a per-tick operator-log `WARN` line
that nothing ever read (7027 identical lines accumulated across four days
while two role questions sat wedged). Two fixes:

- **`./swarm status` renders an "Ask escalation" row**, always — not only
  when something is wrong, since a row that appears only on failure is one
  a human never learns to look for:
  - `ok` — transport configured (whether or not anything is currently waiting).
  - `warn` — transport unconfigured, but nothing is waiting yet. Worth
    saying, not a fault — a signal that is permanently on is how the
    original one went unread.
  - `FAULT` — transport unconfigured **and** at least one question is past
    the escalation threshold; the detail names every waiting role, not just
    the first.
- **The operator log line is written on state CHANGE only**, the same
  last-state pattern the babysitterd watchdog already used — N ticks in one
  state produce one line, not N lines.

## Operator check

```bash
# See pending / escalated ask surface, and the transport's own health
jq '.role_questions, .ask_escalation' .swarmforge/operator/status.json

# Human-readable row (state + which roles, if any, are waiting):
./swarm status | grep -A1 "Ask escalation"

# Synthetic overdue marker (live swarm): back-date asked_at_ms, omit escalated_at_ms,
# wait one operator tick, confirm one GH comment + stamp; next tick silent.
# With no ops issue configured, the same overdue marker turns the status row
# FAULT instead, naming the role.
```

## Related

- [Coordinator `role_ask.bb`](BL-773-coordinator-role-ask-clarifying-question.md) — how asks are raised.
- [Stale approval-ask email escalation](BL-584-stale-approval-ask-email-escalation.md) — Approvals topic, different path.
- BL-1347 owns moving this transport onto BL-584's stale-approval email
  digest; BL-1352 only makes whatever transport is currently in force
  honest about whether it can deliver.

Acceptance: `specs/features/GH-25-role-ask-email-escalation.feature`.
Acceptance (transport visibility):
`specs/features/BL-1352-escalation-transport-fault-is-visible.feature`.
