# BL-607 — hardener PASS

**Verdict:** PASS -> forward to documenter.

Reviewed commit: architect PASS `07d7ff3c38` (property support for
`composeRoleAnswerNoteMessage`), merged into `swarmforge-hardener` as `6c269efaa`.

## Mutation testing — skipped this pass (BL-149 cooldown gate)

Ran `mutation_cooldown_gate.bb` against every changed production file
(`telegram-front-desk-bot.ts`, `telegramFrontDeskBotCore.ts`,
`telegramTopicDecisions.ts`, `role_ask.bb`): all four report `DECISION:
skip-cooldown` (file age 0.07-0.11 days, well inside the 3-day window). No
Stryker run this pass, per protocol — every changed file is still fresh from
today's bounces.

## CRAP — two changed-code violations found and fixed

`npm run crap` over the three changed `src/*.ts` files flagged 8 functions.
Six were pre-existing debt untouched by this ticket's diff against `main`
(`ensureBabysitterTopic`, `candidateApprovalsTopicIds`, `sendApprovalAsk`,
`conciergeTickLoopWithScheduler`, `ensureApprovalsTopic` in
`telegram-front-desk-bot.ts` — identical to `main`, zero diff, out of BL-607's
scope; `attemptVoiceDelivery` in `telegramFrontDeskBotCore.ts` — untouched by
this ticket, and its 96%/CRAP-6.01 flag reproduces on `main`-equivalent code
with no edits at all, i.e. flaky coverage measurement unrelated to this
parcel — left alone per BL-506 scope discipline).

Two were this ticket's own code, both named directly in BL-607's Scope
section:
- `processSteeringUpdate` — complexity 8 (CRAP 8.00 at 100% coverage).
- `deliverAskAnswer` — complexity 8 (CRAP 8.00 at 100% coverage).

Both had the IDENTICAL "capture via delivered-or-queued, clear the pending
marker only if captured" block duplicated verbatim (the architect's own
bounce-2 fix landed the same logic in both call sites). Extracted a shared
`captureRoleAnswer(role, delivered, answerText, enqueueRoleAnswerNote,
clearRolePendingQuestion)` helper (CRAP 3). Both callers now delegate to it:
`processSteeringUpdate` and `deliverAskAnswer` both drop to complexity 6,
CRAP 6.00 — within threshold. Behavior-preserving: the extraction changes
nothing about when the marker clears, only where the decision is written.
Also folded in the stale-comment fix `main` had already applied independently
(`16e7c461dd` — the comment claimed "clears either way", no longer true since
bounce-2 made clearing conditional) so this parcel's comment now matches.

## DRY — one changed-code duplication found and fixed

`npm run dry` (jscpd) flagged `deliverAgentQuestion`
[2615:58-2637:15] as a 23-line/95-token clone of `deliverRoleQuestion`
[2642:40-2667:15] — both this ticket's code (`deliverRoleQuestion` is BL-607's
own addition, built to mirror `deliverAgentQuestion`'s shape exactly, per its
own comment). Extracted the shared button-render/free-text-fallback body into
`deliverAskMessage(topicId, threadId, text, options, adapters)`; both callers
now just resolve their own topicId/threadId and delegate. Clone count 22 -> 21
(the remaining 21 are pre-existing, unrelated to this ticket — including the
deliberate import-list/re-export-barrel echo at the top of this same file,
which is a required structural mirror from the architect's bounce-1 fix, not
extractable logic duplication).

**Self-caught regression during extraction:** an early cut of the
`deliverRoleQuestion` edit accidentally dropped its button-rendering branch
entirely (left it always falling through to the plain-message `sendReply`).
`npm run compile` still passed (no type error - both branches return
`Promise<void>`) but `npm test` caught it immediately: 'BL-607: a roleQuestion
record carrying options sends tappable buttons into the ROLE's own topic'
failed. Fixed by threading `roleAskThreadId(role)` through to
`deliverAskMessage`; full suite green again. Verifies the existing BL-607
test coverage of the button-vs-plain-message branch is non-vacuous.

## Verification (all green after both fixes)

- `npm run compile` — clean.
- `npm test` — 344 files, 5826 tests passed.
- `npm run test:properties` — 11 files, 35 tests passed (includes the
  architect's new `composeRoleAnswerNoteMessage` invariant property).
- `npm run coverage` — 344/5826 green; re-ran CRAP after fix, no BL-607
  function over threshold.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-607-specifier-clarifying-poll.feature` — 6/6 scenarios
  pass. Gherkin is plain `Scenario:` throughout (no `Scenario Outline:` /
  `Examples:`), so BL-113 soft mutation has nothing to run here — confirmed
  by grep, not skipped by omission.
- `swarmforge/scripts/test/test_role_ask.sh` — all 6 shell-level cases pass
  (per-role pending guard, malformed `--options` degrade, bare question).
  Per BL-433, `.bb` mutation/CRAP/DRY tooling is not wired — this suite is
  the real gate for `role_ask.bb` and it is green.
- No orphaned test/mutation processes left running (`ps aux` clean for
  vitest/stryker after every run).

## Note for QA (main-divergence, not a defect in this parcel)

`main` already carries a comment-only commit for this same ticket
(`16e7c461dd`, "BL-607: fix stale comment on pending-marker clear condition",
merged to `main` directly at 05:52 today via `6da4c2602`, chronologically
BEFORE this parcel's architect PASS at 06:05) that is NOT an ancestor of this
branch. It is non-functional (comment text only) and this parcel now carries
an equivalent fix independently, so there is no behavioral conflict — but
when QA lands this parcel's approved commit on `main` it will need an
ordinary merge (not a fast-forward) to reconcile that one line. Flagging so
it isn't mistaken for a lost/dropped bounce fix.

— By hardener.
