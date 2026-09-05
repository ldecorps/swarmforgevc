# BL-1402 — cleaner pass, bounce-1 fix, 2026-09-05

Clean sweep of coder's fix for architect bounce 1. No changes needed;
forwarding as-is.

## Checks run

| check | result |
|---|---|
| `test/telegramFrontDeskBotCore.test.js` (incl. 2 new regression tests) | 459/459 |
| `test/bl1402FrontDeskPhotoPassthrough.test.js` | 9/9 |
| `test/atomicWrite.test.js` | 7/7 |
| property `bl1402FrontDeskPhotoPassthroughInvariants.property.test.js` | 3/3 |
| acceptance `BL-1402-...feature` | 6/6 |
| `npm run compile` | clean |

## Fix review

`persistPhotoIfRouted`'s gate is now an allowlist of the three action kinds
`processMessageUpdate` actually applies `annotateSavedPhotoPath` to
(`post-existing`, `operator-context`, `isOpenDecision`), replacing the old
`!== 'drop'` exclusion the architect found let an approvals/recert-topic
reply's photo through unnecessarily. This is the correct fix shape: an
allowlist keyed to the exact consumers of `photoOutcome`, so it fails safe
against any future `BotUpdateDecision` action kind too (unrecognized means
"don't persist" by construction) rather than requiring every new decision
kind to remember to add itself to an exclusion list.

The two new regression tests
(`BL-1402 architect bounce 1: persistRoutedPhoto is never called for an
approvals-topic reply carrying a photo` /
`...for a recert-topic reply carrying a photo`) drive the real dispatch
with a `persistRoutedPhoto` spy and assert zero calls — confirmed present
and passing, directly covering the defect the architect found.

No duplication or structural issue introduced; the merge conflict from
landing this on top of BL-1383's QA-approved main sync was comment-only
(the function body itself auto-merged cleanly to the fixed gate).

By cleaner.
