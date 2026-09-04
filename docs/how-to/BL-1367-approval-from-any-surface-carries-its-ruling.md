# An approval from any surface carries its ruling (BL-1367)

## What was wrong

Two surfaces could record an approval, and only one could record a
ruling. The bot's callback path reached `pendingApprovalReply.ts`'s
`human_ruling: |` writer; the paused-pager Mini App route
(`/paused-pager/approve`, `computePausedPagerApproveOutcome` in
`extension/src/bridge/bridgeServer.ts`) called
`recordApprovalReply(targetPath, backlogId)` — a signature with no ruling
argument at all. So a ticket declaring `ruling_options` approved from the
phone pager flipped `human_approval` to `approved` and silently discarded
whatever choice it posed. Nothing warned. BL-1309 was approved this way on
2026-09-01; its binary question was never answered, the coder built on its
own reading of it, and QA caught the gap two days later.

## The fix: refuse rather than half-record

`recordApprovalReply` (`extension/src/concierge/pendingApprovalReply.ts`)
now takes an optional `ruling` parameter — the same writer both the bot's
callback path and the pager route call, so a third surface cannot
reintroduce this by growing its own approve path.

Before writing anything, `computePausedPagerApproveOutcome` asks
`classifyApprovalRulingRequirement(rulingOptions, ruling)` what the ticket
needs:

- **`ok`** — either the ticket declares no `ruling_options` (approves
  exactly as before, no `human_ruling:` written), or it does and the tap
  carried a ruling that matches one of them.
- **`ruling-required`** — the ticket declares options and the tap carried
  none.
- **`unknown-option`** — the ticket declares options and the tap's ruling
  doesn't match any of them.

Only `ok` proceeds to record. `ruling-required` and `unknown-option` both
refuse with HTTP `409` (a well-formed request that a rule declined, not a
server fault) and a body naming the outstanding options and pointing the
operator at the bot's ruling keyboard instead — never a bare status code
(BL-572/BL-662). The half-recorded state — approved with the question
still unanswered — can no longer happen from this route.

## What does not change

A ticket with no `ruling_options` field behaves exactly as it did before —
same approval, no ruling ever written for it (invariant 3). An existing
`human_ruling:` is never overwritten or cleared by a later plain approval
from any surface (invariant 2) — `recordApprovalReply`'s caller decides
whether a ruling is being written; the writer itself does not rescue a
caller that skipped the check.

## Verifying

1. A fixture ticket with two `ruling_options`, pending: approve it through
   the pager route with no ruling. Confirm a `409` naming both options,
   and that `human_approval` is still `pending`.
2. Approve the same ticket from the bot's ruling keyboard, choosing one
   option. Confirm `human_ruling:` holds it and `human_approval: approved`.
3. With a ruling already recorded, fire a plain pager approval. Confirm the
   recorded ruling is byte-identical afterwards.
4. A ticket with no `ruling_options`: approve from the pager. Confirm it
   behaves exactly as before, with no `human_ruling:` written.

## Out of scope

Growing the pager UI itself to offer ruling option buttons (a bigger,
separate UI slice). BL-1309's own ruling, which is re-pended and answered
independently of this fix. The `By coder.` byline on approval commits
(BL-1368, a different ticket).

Acceptance: `specs/features/BL-1367-an-approval-from-any-surface-carries-its-ruling.feature`.
