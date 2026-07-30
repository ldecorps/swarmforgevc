# INTAKE — BL-607 role_ask never reaches Telegram (outbox strips roleQuestion)

**Date:** 2026-07-30  
**Urgency:** high / expedite  
**Type:** defect (shipped path broken)  
**Surface:** specifier clarifying questions → Telegram (BL-607)  
**Source:** human via Cursor (2026-07-30), after verifying the specifier topic
had never shown a role ask since BL-607 went live (2026-07-24)

## Human concern (verbatim intent)

Specifier ticket drafting is supposed to percolate clarifying questions to the
human on Telegram (BL-607). The human does not believe the specifier has ever
successfully asked since that landed — which means the path is simply not
working. Confirmed by local forensics below.

**STEERING note:** this is a defect on an already-shipped Telegram path, not
new Telegram product/UI. Eligible under the 2026-07-30 phone-PWA freeze
exception for expedite defects.

## What is broken

`role_ask.bb` appends to `.swarmforge/operator/telegram-reply-outbox.jsonl`
with `roleQuestion` + `options`. The bridge’s
`readNewReplyOutboxEntries` (`extension/src/bridge/operatorEventQueue.ts`)
only forwards `id` / `threadId` / `text` / `retractsPendingQuestion` — it
**drops `roleQuestion` and `options`**.

Front-desk `relayOneRecord` therefore never calls `deliverRoleQuestion`; it
treats the line as an ordinary reply to synthetic thread `role-ask-specifier`,
which does not resolve to the specifier topic (1595), then **acks and silently
drops** the message.

Same class of hole likely affects any outbox path that relies on
`agentQuestion` / `options` surviving the bridge read (verify when fixing).

## Evidence (live host, 2026-07-30)

1. Four `role-ask-specifier` lines in `telegram-reply-outbox.jsonl`
   (stage-then-Save + retract; BL-686; BL-687) — last ask ~2026-07-27T09:04Z.
2. `.swarmforge/operator/role-awaiting/specifier.json` still pending BL-687
   options — never cleared ⇒ human never answered.
3. `backlog/topics/specifier.json` messages empty; `telegram-ask-messages.json`
   absent (no successful `recordAskMessage` for role-ask).
4. Relay cursor `ackedIndex: 656` equals outbox line count — entries were
   “processed” (acked) without Telegram delivery to topic 1595.

## Expected

A `role_ask.bb` question posts into the asking role’s own Telegram topic
(specifier → 1595) with buttons / free-text fallback; answer clears
`role-awaiting/<role>.json` and reaches the live pane or inbox note (BL-607
contract unchanged).

## Suggested fix shape (specifier/coder — not prescribed)

Passthrough `roleQuestion`, `agentQuestion`, and `options` in
`readNewReplyOutboxEntries` / SSE payload; pin with a unit test that a
role-ask outbox line reaches `deliverRoleQuestion` (or equivalent) rather
than `deliverReply`. Do not “fix” by telling the specifier to stop asking.

## Non-goals

- New Telegram UX / new ask surfaces
- Reworking BL-568 menu detection
- Clearing the stale `role-awaiting/specifier.json` without a real answer
  (operator may retract manually if desired; separate from the fix)
