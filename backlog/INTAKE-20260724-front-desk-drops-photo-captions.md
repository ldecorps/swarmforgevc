# Defect — front desk silently drops any photo/media message: messageTextOf ignores captions

**From:** operator, 2026-07-24 ~06:50Z, root-caused live after the human's
Concierge message (a usage screenshot with a caption directive) got no reply
**Severity:** medium-high (a human message class silently vanishes; second
silent-drop incident in 12 hours after the token-theft outage)

## Defect

`extension/src/tools/telegramTopicDecisions.ts` — `messageTextOf` reads ONLY
`update.message?.text`. Telegram puts the words of a photo/media message in
`update.message.caption`, so any photo+caption from the principal fails
eligibility with `no-text` and is silently `dropped` (offset advances, no log,
no reply). Proven by replay against the compiled core with live env:

    photo+caption -> {"action":"drop","reason":"no-text"}
    identical words as plain text -> {"action":"open-for-topic",...}

## Fix shape (specifier confirms scope)

1. `messageTextOf` returns `text ?? caption`. Every consumer (eligibility,
   steering, reserved-subject parsing) inherits caption support from that one
   line. Unit-test the caption case; fixture = the 2026-07-24 incident shape
   (photo + caption directive from principal in a bound topic).
2. The attached image itself is NOT processed (no vision in the front desk).
   Decide explicitly: caption-only routing (cheap, likely right) with a
   receipt noting the image was not read, vs. any image handling (own ticket
   if ever wanted). Never again SILENT: whatever the choice, a media message
   from the principal must produce either a routed action or a logged,
   visible refusal.
3. Fold into the drop-reason audit line already requested in
   INTAKE-20260724-onboarding-telegram-token-separation.md item 3 — this
   incident is exactly the class that audit line exists to make diagnosable
   in minutes instead of a replay session.

## Related live observation (same log, unresolved)

`front-desk bot: reply-relay degraded - 5 consecutive reconnect failures,
still retrying: terminated` recurs in the CURRENT bot generation (started
03:27Z) — the open SSE silent-stop from the front-desk resilience track
(BL-369/370/371 lineage). Even correctly-routed inbound may get no visible
reply while the relay is down. Specifier: check whether the existing
resilience tickets cover reconnect-exhaustion, or whether this is a new hole.
