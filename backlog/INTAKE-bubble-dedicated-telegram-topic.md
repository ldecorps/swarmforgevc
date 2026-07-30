# INTAKE — Pilot Bubble as its own Telegram topic

**Date:** 2026-07-30  
**Urgency:** high (human confusion in live flow; low-risk routing fix)  
**Type:** pilot / messaging surface refinement  
**Surface:** Cursor bridge forum-topic routing + Let's Talk mirroring  
**Source:** human via Cursor (2026-07-30)

## Human ask (verbatim intent)

Give **Bubble / Let's Talk** its own Telegram forum topic instead of posting
those turns into **Cursor Remote**. The current behavior makes it look like
Cursor Remote is the agent's memory, when it is only a control/chat surface.

## Why this pilot matters

- Separates **conversation history** (Bubble topic) from **operator controls**
  (Cursor Remote verbs + typed agent prompts).
- Removes a misleading UX where Bubble replies in Cursor Remote imply memory
  persistence that does not exist.
- Creates a dedicated place for Bubble follow-ups and poll responses without
  burying operator command logs.

## Pilot shape

| Surface | Role |
|---------|------|
| **Bubble** standing topic (`BUBBLE`, display name `Bubble`) | Primary log for Let's Talk turns (`You:` / `Bubble:`), choice polls, and typed follow-ups made in that same topic |
| **Cursor Remote** | Host-agent remote control only (slash verbs, typed direct prompts), not the Let's Talk dump target |
| Shared `agentId` | Unchanged during pilot: Bubble voice turns and Cursor Remote typed prompts still hit the same host-agent session |

## Acceptance sketch

- Cursor bridge startup ensures Bubble topic exists (reuse when present,
  create when missing) alongside Cursor Remote.
- Let's Talk turn-mirror path posts to Bubble topic id rather than
  `cursorTopicId`.
- Topic map exported to front desk omits Bubble (and Cursor Remote) so
  Concierge topic ownership does not absorb them.
- Inbound text from Bubble topic is accepted by bridge polling and responses
  land back in Bubble topic.

## STEERING / freeze note

This is a **routing and operator-clarity** pilot on existing Telegram surfaces,
not new Telegram product UI. It fits the phone-PWA freeze constraint because it
reduces operator confusion without adding a new app surface.

## Non-goals

- Splitting Bubble and Cursor Remote into different backend `agentId`s
- Making Telegram history reloadable as model memory
- Reworking Concierge role-topic assignment model
