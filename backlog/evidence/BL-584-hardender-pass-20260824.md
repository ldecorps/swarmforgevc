# BL-584 — hardender pass — 20260824

## Inbound

Architect tip `40e2fa6473`. Per FF-only instruction: **recreated**
`swarmforge-hardender` on that tip.

Hitchhike gate before handoff → CLEAN.

## Scope

Stale Approvals-topic ask email digest (front-desk sweep). Hardened Example
binding (outcome/state/chat_id/message_id), write-before-send anti-storm unit,
and removed a vacuous `message_id` on the invalid-chat deep-link row.

## Host / cooldown

`mutation_cooldown_gate.bb` absent on this tip (degraded). Soft Gherkin on
mutated Example scenarios: **12/12** killed (0 survived) this pass.

## Harden locks

- Step handlers reject unknown outcome / human_approval / chat_id /
  message_id Example values.
- Unit: cooldown `writeLastSentMs` runs before `sendEmail` (send may throw).
- Feature: `not-a-number` deep-link row uses `message_id=absent`.

## Hand-authored surgical

| Mutant | Result |
|---|---|
| treat approved as stale | killed |
| drop oldest-first sort | killed |
| human activity does not reset clock | killed |
| fail-open missing ask clock | killed |
| write cooldown after send | killed |

Survivors: 0.

## Verification

- Unit escalation/config/conciergeTick **132+** (escalation 17/17)
- Property **1/1**
- Acceptance **20/20**

## Findings

NONE.

## Forward (FF-only)

`git_handoff` to `documenter`, priority `00`, task
`BL-584-stale-approval-ask-email-escalation`.

Documenter: recreate on this tip; do not merge into hitchhiked ancestry.

By hardender.
