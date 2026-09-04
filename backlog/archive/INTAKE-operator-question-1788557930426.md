# Intake: a question the Operator could not answer

Filed by the Operator (2026-09-04T21:38:50.426992921Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

Front desk drops Telegram photos irrecoverably - wire a photo passthrough so an attached image reaches the operator (human said "oui" to filing this, thread SUP-17, 2026-09-04 21:37Z).

Today the human sent a screenshot asking "ces thresholds sont trop bas?" and the operator could not see it. annotateRoutedMediaText (extension/src/tools/telegramFrontDeskBotCore.ts:231) appends "[image attached - not read by the front desk]" to the text when update.message.photo exists, and that annotation is ALL that survives: the photo[] array, hence every file_id, stays in the poller and is never persisted. That was deliberate (BL-620, "the front desk has NO vision", so nobody believes the image was read), but the side effect is that the image is unrecoverable after the fact - the getUpdates offset is already consumed by the front desk poller, and re-polling from elsewhere would 409 against it.

This is wiring, not invention - all three pieces already exist in this repo: largestTelegramPhotoFileId + downloadTelegramFile + the 8MB cap in extension/src/bridge/cursorBridgeTelegramMedia.ts (BL-696, a bridge-only route that DOES see the human's photos); and the front desk itself already does the two-step Telegram getFile -> GET download for voice notes (resolveVoiceAudio, telegram-front-desk-bot.ts:1907, BL-426), so the bot token, HTTP client and download path are already inside that process - it downloads voice and throws away photos. The only missing link is persisting the bytes (e.g. .swarmforge/operator/media/<update_id>.jpg) and surfacing that path in .swarmforge/operator/telegram-reply-context.json, which today carries only thread-id / transcript / long-term-memory; the operator reads image files natively once one lands on disk.

No active or paused ticket covers this: BL-620 and BL-955 are done (annotation on each forwarding surface) and BL-696 is bridge-only. Operator files only - speccing, sizing and promotion stay with the specifier and the coordinator.

---

## Drained 2026-09-04 (specifier) — minted as BL-1402

Specced as **BL-1402** ("The front desk keeps a routed Telegram photo on
disk and names the saved path in the routed text"), `backlog/paused/`,
`human_approval: pending` with one ruling (captioned photos only in this
slice, recommended, vs also routing bare photos as a follow-up slice). The
human's thread words are quoted verbatim in the ticket's `source:`. Every
code claim above was verified against main at mint. Archived with this
pointer.
