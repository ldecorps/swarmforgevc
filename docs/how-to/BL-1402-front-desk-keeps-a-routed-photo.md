# The front desk keeps a routed photo (BL-1402)

## What it is

A captioned Telegram photo the front desk routes is now saved to disk
under `.swarmforge/operator/media/<update_id>.<ext>` and the routed text
carries a second line naming that path, right after
[BL-620's own "not read" note](#relationship-to-bl-620--bl-955). Before
this, `annotateRoutedMediaText` appended that note and the `photo[]`
array/`file_id` were discarded — the getUpdates offset had already
consumed them, so nothing could fetch the image later. The human's own
screenshot (2026-09-04 21:26Z, "Ces thresholds sont trop bas?") reached the
operator as a caption with no picture; this closes that gap.

## Relationship to BL-620 / BL-955

The front desk still has **no vision** — `annotateRoutedMediaText` (BL-620)
stays byte-identical, on purpose: BL-620's tests assert `/image.*not
read/i` and BL-955 asserts that exact note with `includes`. Keeping the
bytes on disk never implies the front desk read the image. The saved-path
line is a **separate** pure step, `annotateSavedPhotoPath`, applied always
*after* `annotateRoutedMediaText` at the same posting boundary — the two
notes never merge into one.

## Where it lives

- `persistRoutedPhoto` (`telegram-front-desk-bot.ts`): the live I/O. Reuses
  Telegram's two-step `getFile` → `GET` (the same shape `resolveVoiceAudio`
  already uses for voice notes), picks the largest photo size
  (`largestTelegramPhotoFileId`), enforces `MAX_TELEGRAM_PHOTO_BYTES` (8
  MB, from `cursorBridgeTelegramMedia.ts`), and writes via
  `atomicWrite`'s temp-and-rename shape (widened to accept `Buffer`).
- `annotateSavedPhotoPath` / `PhotoPersistOutcome`
  (`telegramFrontDeskBotCore.ts`): the pure text step —
  `saved`/`already-saved` appends `[image saved: <path>]`; `not-applicable`
  and `failed` leave the text untouched.
- `persistPhotoIfRouted` (`telegramFrontDeskBotCore.ts`): gates
  `persistRoutedPhoto` to the three decision kinds whose posted text
  actually applies `annotateSavedPhotoPath` — `post-existing`,
  `operator-context`, and an "open" decision (a fresh subject). It runs
  **once** in `processMessageUpdate`, before any of those three posting
  boundaries, the same "decide once, every surface carries the result"
  posture BL-620's own annotation already uses.

## The gate is an allowlist, not a `drop`-exclusion (architect bounce 1)

The first cut excluded only `decision.action === 'drop'`, which let an
Approvals-topic or Recert-topic reply's photo through the gate too — but
neither of those delivery paths (`deliverApprovalsTopicReply`,
`deliverRecertTopicReply`) ever consumes `photoOutcome`; they call
`annotateRoutedMediaText` directly with no saved-path line. That wasted a
fetch/write for a result nobody would see, and risked `pruneMediaStore`
evicting a *different*, genuinely-referenced photo to make room for it.
`persistPhotoIfRouted` now allowlists the three action kinds that actually
apply the annotation, failing safe for any future decision kind —
unrecognized means "don't persist," never "persist by default."

## Invariants

1. **A photo that cannot be kept never blocks its caption.** Any fetch
   failure (`getFile`, download, the 8 MB size cap) routes the caption with
   text byte-identical to before the fix; `formatPhotoPersistFailureAuditLine`
   logs one bounded line naming the update id and the reason, never
   content; no file is written.
2. **BL-620's note stays byte-identical on every forwarding surface** — the
   saved-path line rides on its own line after it, never merged in.
3. **The store is bounded and idempotent.** `existingMediaFile` checks for
   a file already saved under that update id *before* any network call —
   a redelivered update costs one `readdir`, never a re-fetch or
   re-write. `pruneMediaStore` keeps the newest `ROUTED_PHOTO_STORE_BOUND`
   (50) files, oldest `mtime` first; a prune failure is logged, never
   thrown.

## Explicitly out of scope

A photo with **no caption** stays dropped as `media-no-caption` (BL-620) —
per the human's own ruling, routing bare photos with a placeholder caption
is a follow-up slice, not this one. Also out of scope: giving the front
desk itself vision, the cursor bridge's own (already-working) photo route
(BL-696), and documents/stickers/video.

## Verifying

1. Run the BL-1402 feature, then BL-620's and BL-955's unchanged — every
   scenario still passes.
2. Live: send a captioned photo to the front desk. Within one poll,
   `.swarmforge/operator/media/<update_id>.<ext>` exists and opens as the
   image; the routed text carries BL-620's note then the saved-path line.
3. Replay the same update through the poll seam in a fixture (Telegram
   redelivery cannot be forced): one file, unchanged `mtime`.
4. Fixture a `getFile` failure, a download failure, and an over-size photo
   — each still routes the caption unchanged, logs one audit line, writes
   no file.
5. Seed the store with `ROUTED_PHOTO_STORE_BOUND` older files, persist one
   more: count stays at the bound, the oldest file is gone.

Acceptance: `specs/features/BL-1402-the-front-desk-keeps-a-routed-photo-so-the-operator-can-see-it.feature`.
