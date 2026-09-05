# BL-1402 — coder fix for architect bounce 1, 2026-09-05

## Defect (architect bounce 1, `BL-1402-architect-bounce1-20260905.md`)

`persistPhotoIfRouted`'s gate excluded only `decision.action === 'drop'`,
so a captioned photo replied into the Approvals or Recert topic (any
`approvals-topic-*`/`recert-*` decision) still triggered a real network
fetch + atomic write + `pruneMediaStore` eviction — even though neither
`deliverApprovalsTopicReply` nor `deliverRecertTopicReply` ever consumes
`photoOutcome` (they call `annotateRoutedMediaText` directly, no saved-path
line). Wasted work at best; at worst, `pruneMediaStore` could evict a
different, genuinely-referenced photo to make room for one nobody would
ever see the path to.

## Fix

`persistPhotoIfRouted`'s gate is now an ALLOWLIST of the exact three action
kinds `processMessageUpdate` actually applies `annotateSavedPhotoPath` to
(`post-existing`, `operator-context`, `isOpenDecision`) instead of a
`!== 'drop'` exclusion. Fails safe against any future decision kind too: an
unrecognized action now means "don't persist" by construction, never
"persist by default."

## Verification

| check | result |
|---|---|
| `test/telegramFrontDeskBotCore.test.js` (existing + 2 new regression tests) | **459/459** |
| `test/bl1402FrontDeskPhotoPassthrough.test.js` | 9/9 unchanged |
| `test/atomicWrite.test.js` | 7/7 unchanged |
| property `bl1402FrontDeskPhotoPassthroughInvariants.property.test.js` | 3/3 unchanged |
| acceptance `BL-1402-...feature` | 6/6 unchanged |
| BL-620/BL-955 features (regression) | 13/13, 8/8 unchanged |
| `npm run compile` | clean |

## New regression tests (per the bounce's own remediation request)

Two new tests in `telegramFrontDeskBotCore.test.js`, driving the REAL
dispatch with a `persistRoutedPhoto` spy:

- an approvals-topic reject reply carrying a photo (`caption: "reject
  BL-433 no good"` in a topic bound to `APPROVALS_SUBJECT_ID`) — asserts
  `persistRoutedPhoto` is called zero times, and that the reject itself
  still records normally.
- a recert-topic validate reply carrying a photo, same shape, against
  `RECERT_SUBJECT_ID` and `recordRecertValidate`.

Both would have failed against the pre-fix gate (the spy would have
recorded a call).
