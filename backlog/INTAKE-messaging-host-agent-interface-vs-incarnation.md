# INTAKE — Messaging and host agent: interface vs incarnation (no blind rename)

**Date:** 2026-07-30  
**Urgency:** low (vocabulary / docs; prevents a harmful rename sweep)  
**Type:** docs / naming policy  
**Surface:** Spec glossary, operator how-tos, future adapter work  
**Source:** human via Let's Talk / Cursor (2026-07-30)

## Human ask (verbatim intent)

Find a balance between future-proof abstraction and practical everyday names.
Think object-oriented: **interface** vs **incarnation**.

- Architecture / docs may talk about **messaging** and **host agent**.
- Day-to-day life still talks about **Telegram** and **Cursor** — those are the
  live incarnations of those concepts today.
- Do **not** force a vast rename that makes Telegram or Cursor “disappear” from
  code and docs. Strict one-name-everywhere either freezes vendor names forever
  or forces awkward abstract words into operator speech. Two layers is deliberate.

## Locked vocabulary

| Layer | Term | Current incarnation | Notes |
|-------|------|---------------------|--------|
| Interface | **messaging** (channel / chat adapter) | **Telegram** | Easy human messaging path; other chat apps remain possible later |
| Interface | **host agent** | **Cursor** | IDE / Remote seat (verbs, Let's Talk pairing, future pack ACP staffing) |
| Phone app | **Bubble** | native Android app (`android/`, BL-707) | **Product name** of the operator phone. Origin: chatbox → floating overlay → full phone. Standing Telegram topic **Bubble** mirrors its talk. Code/package may still say Float Companion / `floatcompanion` — that is implementation residue, not a second product |

Doc sentence style: “The host agent (today: Cursor) …” / “Messaging (today: Telegram) …” /
“The phone app is **Bubble** …”

### Product naming lock (2026-07-30, human)

- Say **Bubble** for the phone app in STEERING, intakes, Spec, how-tos, and
  operator speech.
- Do **not** introduce a parallel product brand (Float Companion, companion app,
  overlay app) in new prose. Historical ticket titles (`BL-707-…-companion`) and
  Android package ids may stay; new copy prefers Bubble.
- The Telegram forum topic named **Bubble** is the discussion surface for that
  app’s talk — same name on purpose.

## Explicit non-goals (do not pull as a rename epic)

- No mechanical rename of `telegram-*` files, `TELEGRAM_*` env vars,
  `telegram-reply-outbox.jsonl`, or Telegram HTTP client symbols “for purity.”
- No mechanical rename of Cursor Remote / `telegramCursorBridge*` modules to erase
  “Cursor” from identifiers in one pass.
- No rewrite of `backlog/done/**` or historical evidence.
- Dual-name shims at adapter edges are **only** if a later ticket needs a real
  second messaging app or second host-agent backend — not as a vocabulary chore.

## Desired outcome

1. Spec gains a short **interface vs incarnation** glossary (near the existing
   chat-adapter section).
2. New / forward-looking prose may use interface words when explaining
   architecture; operator how-tos keep Telegram and Cursor when describing live
   bounce paths, env, and verbs the human must type.
3. Specifier / coordinator treat a “rename everything off Telegram/Cursor”
   proposal as **out of policy** unless the human explicitly requests a second
   incarnation and a shim plan.

## Acceptance sketch

- This intake exists under `backlog/`.
- Spec glossary states the table above (including **Bubble** as phone-app product name).
- No live path or identifier rename is required to close the vocabulary intent.
