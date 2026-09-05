# BL-1402 — architect bounce 1, 2026-09-05

One defect found. Full inventory below (Article 4.4): everything else
checked and clean.

## Checks run (clean)

| check | result |
|---|---|
| `dependency-gate.js` on the 3 changed TS files | PASSED: no forbidden edges |
| `co-change-report.js` on the 3 changed TS files | no pair at or above threshold (all counts = 1) |
| `test/telegramFrontDeskBotCore.test.js` | 457/457 |
| `test/bl1402FrontDeskPhotoPassthrough.test.js` | 9/9 |
| `test/atomicWrite.test.js` | 7/7 |
| property `bl1402FrontDeskPhotoPassthroughInvariants.property.test.js` | 3/3 |
| acceptance `BL-1402-...feature` | 6/6 |
| acceptance `BL-620-...feature` (regression) | 13/13 unchanged |
| acceptance `BL-955-...feature` (regression) | 8/8 unchanged |
| `required_wiring` anchor `persistRoutedPhoto(` | resolves to real call, `telegram-front-desk-bot.ts:2567` in `buildPollAdapters` |
| Invariant 1 (fetch failure never blocks caption) | property + acceptance confirm, code review confirms (`persistPhotoIfRouted` catches `failed` and still returns the outcome; caller always posts) |
| Invariant 3 (bounded + idempotent store) | property + acceptance confirm the counters; code review of `existingMediaFile`/`pruneMediaStore` confirms the shape |
| Cursor-bridge photo route (BL-696) | untouched, confirmed empty diff |
| Secrets/architecture | no violation — extension host owns the fetch/write, no webview touched |

## D1 — `persistPhotoIfRouted`'s gate persists for a decision whose posted
text never carries the result, wasting work and risking eviction of a
referenced photo

**File**: `extension/src/tools/telegramFrontDeskBotCore.ts`
**Lines**: `persistPhotoIfRouted` (new, ~2886-2905) and its call site in
`processMessageUpdate` (~2921, `const photoOutcome = await
persistPhotoIfRouted(update, decision, adapters);`)

`persistPhotoIfRouted` is called unconditionally for every
`decision.action !== 'drop'`, before `processMessageUpdate` branches on
which delivery path the decision actually takes. Only three of those
branches consume `photoOutcome` via `annotateSavedPhotoPath` — `post-existing`,
`operator-context`, and the `isOpenDecision` branch (`openSubjectAndRecord`).
The fourth branch, `deliverReservedSubjectReply` (approvals-topic and
recert-topic replies — `isApprovalsTopicReplyDecision` /
`isRecertTopicReplyDecision`, `telegramFrontDeskBotCore.ts:1580`/`1677`),
never receives `photoOutcome` at all: its own delivery functions
(`deliverApprovalsTopicReply`, `deliverRecertTopicReply`) call
`annotateRoutedMediaText` directly with no saved-path annotation.

But `decision.action` for an approvals/recert-topic reply is never `'drop'`
(`'approvals-topic-approve'`, `'approvals-topic-reject'`,
`'approvals-topic-qjump'`, `'approvals-topic-ambulance'`,
`'approvals-topic-unrecognized'`, or the recert equivalent), so the gate in
`persistPhotoIfRouted` lets these through. Telegram allows any message —
including a reply in the approvals topic ("approve BL-123") — to carry both
text and a photo. When that happens today (post-BL-1402):

1. `persistRoutedPhoto` runs a real network fetch (`getFile` + download) and
   an atomic write to the bounded media store.
2. `pruneMediaStore` may evict the store's oldest file to stay within
   `ROUTED_PHOTO_STORE_BOUND` — which could be a photo a *different*,
   genuinely-routed message saved and that the operator has not looked at
   yet.
3. The saved path is never surfaced anywhere: `deliverApprovalsTopicReply`/
   `deliverRecertTopicReply` post `annotateRoutedMediaText(...)` only, so
   the file just written sits in the store unreferenced by any posted text.

Net effect: a wasted network call, a wasted disk write, and a real
possibility of evicting a legitimately-referenced photo to make room for
one nobody will ever see the path to — silently, with no audit line either
(this path isn't a `'failed'` outcome, so `formatPhotoPersistFailureAuditLine`
never fires).

This is not covered by any of the three declared invariants literally (none
of them says "never persist when the result won't be shown"), but it's a
concrete, reachable correctness gap in the parcel's own design intent —
the coder's own evidence explicitly scoped OUT "the steering..., onboarding,
agent-questions, **approvals-reject**, or **recert-amend** surfaces" from
receiving the annotation, but the persistence *call* was not scoped out
along with it. No test in this parcel exercises an approvals/recert-topic
reply carrying a photo (`grep -rn 'approvals-topic\|recert'
extension/test/bl1402FrontDeskPhotoPassthrough*.test.js
specs/pipeline/steps/bl1402FrontDeskPhotoPassthroughSteps.js` — zero hits),
so this gap shipped untested.

**Remediation**: gate `persistPhotoIfRouted`'s call (or its internal check)
on the same discriminator the coder already scoped the annotation to — skip
persistence when `isApprovalsTopicReplyDecision(decision) ||
isRecertTopicReplyDecision(decision)` (or equivalently, only call it for the
three action kinds that actually consume `photoOutcome`), so a photo
attached to a reserved-subject reply is left untouched exactly as it is
today, with no network call and no store churn. Add a scenario or unit test
driving an approvals-topic (or recert-topic) reply with a photo attached,
asserting no file is written and no fetch occurs.

By architect.
