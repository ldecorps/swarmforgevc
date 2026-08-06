# BL-811 — hardener pass

Reviewed commit: `671b369266` (architect, clean, no findings). Parcel diff
scope unchanged from the coder/architect passes: `90a4608f..a84ea970fb`, 6
files (2 source, 1 property test, 2 acceptance step-handler files, 1
evidence file).

## Host load — Stryker skipped, targeted-test hardening instead

`uptime` throughout this pass: load averages 56-127 on a 4-core host (>>2x
cores), matching this project's own "Stryker dry-run times out even at
concurrency=1 under severe load" lesson. Per the hardening order, mutation
testing (Stryker) was not attempted. Fell back to a coverage-gap hardening
pass with the existing test suite instead, plus CRAP/DRY (both light enough
under load to run safely — verified they completed without stalling).

## Coverage-gap hardening: one new integration-level regression test

The D1 fix (`decideQueuedPollAnswerAction` requiring a real numeric
`clearAllOptionIndex` match) was covered by the coder at the PURE-FUNCTION
level only: a property test (1000 runs) and a pinned example test, both
calling `decideQueuedPollAnswerAction` directly. Nothing exercised the fix
through the real `runCursorBridgePollOnce` -> `processQueuedPollAnswer` path
with a persisted "legacy" poll (no `clearAllOptionIndex` field) and a real
retraction (`option_ids: []`) — the exact integration shape the ticket's own
E2E procedure item 1 names as the key manual check, and the exact shape a
production regression would take (a wiring defect between the pure decision
and the state-persistence call site would not be caught by the pure-function
tests alone).

Added `extension/test/telegramCursorBridgeLive.test.js`:
`runCursorBridgePollOnce ignores a vote retraction against a legacy poll
with no clearAllOptionIndex field, leaving the queue and poll untouched`.
Drives the real `runCursorBridgePollOnce` with a persisted legacy-shaped
poll and a retraction poll_answer update; asserts the queue and poll both
survive byte-identical, no run starts, and no "Cleared" receipt is posted.

**Non-vacuity, proven directly**: reintroduced D1 in
`telegramCursorBridgeCore.ts` (dropped the `typeof pendingPoll.clearAllOptionIndex
=== 'number'` guard, matching the coder's own reintroduction), recompiled,
reran — the new test failed exactly as expected
(`AssertionError: the retraction must not wipe the queue`, `0 !== 1`).
Restored the fix, recompiled, reran clean.

## Verification runs

- `npm run compile` — clean, both before and after restoring the fix.
- `npx vitest run test/telegramCursorBridgeLive.test.js
  test/telegramCursorBridgeCore.test.js
  test/telegramFrontDeskBotCore.test.js test/cursorBridgeInboundQueue.test.js
  test/telegramCursorBridgeLiveness.test.js` — 609/609 pass (was 608; +1 for
  the new regression test).
- `npm run test:properties -- test/bl811HostQueueInvariants.property.test.js`
  — 3/3 pass.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-810-host-queue-selection-poll-clear-all-and-ttl.feature`
  — 12/12 pass.
- Scoped `npx vitest run --coverage` over the seven non-property unit test
  files that import either changed source file (`telegramCursorBridgeLive`,
  `telegramCursorBridgeCore`, `telegramFrontDeskBotCore`,
  `cursorBridgeInboundQueue`, `cursorBridgeAgentSession`, `letsTalkBridge`,
  `telegramCursorBridgeCli`) — 679/679 pass, used to compute CRAP below.
  Property-test files excluded per the engineering separation rule.

## CRAP (scoped to `src/*.ts`, not `out/*.js` — BL-381)

`node scripts/crapReport.js src/tools/telegramCursorBridgeCore.ts
src/tools/telegramCursorBridgeLive.ts`:

- **`decideQueuedPollAnswerAction`** (new, this parcel): complexity 6,
  coverage 100%, **CRAP 6.00 — compliant** (at, not over, the threshold).
- **`processQueuedPollAnswer`** (modified, this parcel): complexity 17,
  coverage 95%, **CRAP 17.03 — exceeds 6**. Checked against the pre-parcel
  version (commit `90a4608f`): complexity was **19** before this parcel's
  own extraction of `decideQueuedPollAnswerAction` pulled the D1 decision
  logic out — this parcel *reduced* the function's complexity, it did not
  introduce the violation. At 95%+ coverage the CRAP formula
  (`comp^2*(1-cov)^3 + comp`) reduces to essentially `comp` itself, so no
  further test-writing can bring this under 6 — only further decomposition
  can. The remaining complexity is the busy-check / active-run-guard /
  `handleInboundDecision` dispatch bookkeeping shared with the function's
  pre-existing shape, not the D1 fix. Splitting it further would mean
  restructuring the poll-answer dispatch/persist/invoke sequence — the
  ticket's own `out_of_scope` explicitly excludes "broader refactors of
  queue architecture unrelated to starvation," and this bookkeeping is
  shared verbatim with `processChoicePollAnswer`'s own dispatch tail (see
  DRY below), so a partial split here alone would not fix the pattern.
  Not blocking this pass; noted below as a candidate follow-up.
- **24 other flagged functions** in the same two files (e.g.
  `handleOperatorGateDecision` CRAP 1406.36, `followOperatorExecuteResult`
  CRAP 104.20): confirmed via `git diff 90a4608f a84ea970fb` that **none**
  of these functions' bodies were touched by this parcel — all pre-existing,
  unrelated to BL-811. Not this parcel's debt to pay down (review ticket,
  not a rewrite ticket, per the ticket's own `notes`).

**Candidate follow-up (not filed — specifier's call, informational only)**:
`telegramCursorBridgeLive.ts` carries severe pre-existing CRAP debt,
`handleOperatorGateDecision` (CRAP 1406) most notably. Worth a dedicated
CRAP-reduction ticket independent of this one.

## DRY

`npx jscpd --config .jscpd.json src/tools/telegramCursorBridgeCore.ts
src/tools/telegramCursorBridgeLive.ts` — 2 clones found (0.75% duplicated
tokens):

1. Lines 1095-1102 / 1121-1128 (typescript) — unrelated to this parcel's
   diff (outside both changed functions).
2. Lines 1518-1531 / 1578-1591 — the `handleInboundDecision(...)` call-site
   options object, duplicated between `processQueuedPollAnswer` and
   `processChoicePollAnswer`. Confirmed pre-existing: the identical call
   site (same option keys, same shape) exists at the equivalent lines in the
   pre-parcel file (`90a4608f`); this parcel changed only the value bound to
   `decided.itemId` inside it, not the duplication itself.

Neither clone was introduced by this parcel; not fixed here (structure-
preserving DRY cleanup is the cleaner's stage per Article 1.4, and this
duplication predates BL-811).

## Mutation manifests

No Stryker manifest changes — mutation was not run this pass (host load, see
above). No manifest to preserve or regress.

Forwarding to documenter.
