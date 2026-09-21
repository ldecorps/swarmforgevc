# BL-1658 — QA bounce fix (D1), coder, 2026-09-21

## What the bounce asked for

QA's bounce (`backlog/evidence/BL-1658-qa-bounce-20260921.md`): the
documenter's forward (5e5e262df8) was built against the eight-handler
contract, but amendment (3) landed on `main` at 13:52 local (before this
parcel reached QA at 13:39) expanding scenario 01 to nine handlers
(bl1146 added), adding scenario 02's "twenty-two" wording, and adding an
entirely new scenario 03 (fifteen eager cursor-bridge requirers, a census
grep). 17 of 25 scenario outcomes failed for one root cause: the step
handler recognized none of the amendment's new contract.

## What changed

1. **`specs/pipeline/steps/bl1658SevenJsdomHandlersLoadLazilySteps.js`**:
   added `bl1146...` to `HEAVY_MODULE_CHECK`; renamed/grew
   `EIGHT_NAMED_HANDLERS` to `NINE_NAMED_HANDLERS`; added
   `FIFTEEN_CURSOR_BRIDGE_HANDLERS` (BL-1445 pin) and
   `TWENTY_TWO_NAMED_HANDLERS` (the union scenario 01 and 03's shared
   steps validate against - 9 + 15 - 2 overlap = 22, not 24); renamed the
   "of the eight" step to "of the twenty-two"; added scenario 03's two new
   steps (the cursor-session-only check, and the census grep).
2. **Fourteen handler files now require their heavy module lazily**
   (bl1146 plus the thirteen the amendment's scenario 03 names beyond
   bl1050/bl1146, which were already fixed): each converted from N
   module-scope `require(...)` calls (the handler's own direct
   cursor-bridge import PLUS, in most, an already-eager
   `bridgeServer`/`telegramCursorBridgeLive` production import that
   itself transitively requires `cursorBridgeAgentSession` - moving only
   the direct import would not have cleared the census) to a single
   `lib()` lazy-bundle function, required once on first use and cached.
   Every call site converted from a bare `name(...)` to `lib().name(...)`;
   every bare constant reference (e.g.
   `LETS_TALK_HANDS_FREE_SILENCE_MS`) converted the same way. No draw, no
   assertion, no scenario text changed in any of the fourteen files -
   verified by running each handler's own acceptance feature before and
   after (see Verification).
   Files: bl1146HostQueueEnqueueNextHoldOnHostQuestionSteps.js,
   bl1253DeadFeederOwnsGetUpdatesStampSteps.js,
   bl1322BridgeLazyCursorApiKeySteps.js,
   bl1384LocalSeatTopicForwardedSteps.js, bl545CatchUpPagerSteps.js,
   bl696LetsTalkSteps.js, bl696TelegramCursorBridgeOperatorSteps.js,
   bl697LetsTalkHandsFreeSteps.js, bl717SilentReturnAfterHoldMusicSteps.js,
   bl718BubbleTalkMirrorSteps.js,
   bl767QueuedBridgeQuestionsAnswerInOriginTopicSteps.js,
   bl790BridgeQueuesNoteForRoleSteps.js,
   bl810HostQueuePollClearAllTtlSteps.js,
   bl894QueueRepostsSelectionPollSteps.js.

## Spec-gap: the census grep names twenty, not the amendment's nineteen

Implementing scenario 03's own census-grep step surfaced a second miscount
(the first was bl1239 for BL-1677, same day): the real grep over
`specs/pipeline/steps` for `cursorBridgeAgentSession` names TWENTY files,
not nineteen. The twentieth, `bl1207AbandonedLockLivenessSteps.js`
(committed 2026-08-28, weeks before this ticket), already lazy-loads the
module correctly (a `MODULE_PATH` const, `require(MODULE_PATH)` inside a
function) - not an eager offender, not one of the fifteen, simply missed
by whichever census produced "nineteen". Filed as a spec-gap `note`
(priority 00,
`backlog/evidence/BL-1658-spec-gap-census-twenty-not-nineteen-coder-20260921.md`)
and, per this session's repeated precedent for a same-shape miscount
discovered mid-implementation, corrected the feature file's wording and
this handler's assertion from nineteen to twenty (a one-word factual
correction, not a scope or structural change) - ready to revert if the
specifier's ruling differs.

## Three unowned reds found while verifying, none caused by this parcel

Ran each of the fourteen fixed handlers' own acceptance feature before
(stashed) and after this parcel's edit to confirm zero behavioral
regression. Three scenarios fail identically in BOTH states (confirmed
pre-existing, unrelated to require-timing):
- BL-1384 scenario 02: a local-seat model-catalogue mismatch
  (`qwen2.5-coder:latest` expected, `qwen3:14b` found) -
  `unowned-red-bl1384-model-catalogue-mismatch-coder-20260921.md`.
- BL-696 (miniapp) scenario "a transient speech-to-text failure...": a
  served-page content check -
  `unowned-red-bl696-two-preexisting-failures-coder-20260921.md`.
- BL-696 (operator commands) scenario "/redeploy compiles...": a
  `decideInboundAction` decision-shape mismatch - same evidence file as
  above.
Both filed as `unowned-red` notes (priority 00) to specifier and
coordinator per the standing-red rule.

## Verification

- `npm run compile`: clean.
- `npx vitest run test/stepHandlerTmpRootGuard.test.js`: 4/4 pass (every
  new `lib()` bundle calls a recognised registration marker via its own
  member calls - no leaked temp root risk introduced).
- `npx vitest run test/stepHandlerModuleLoadBudget.test.js`: 8/8 pass.
- `npm test` (extension/, full unit lane): 635/635 files, 10848/10848
  tests pass - the standing red this ticket owns
  (`bl1146HostQueueEnqueueNextHoldOnHostQuestionSteps.js`, register row
  in `backlog/standing-reds.tsv`) is now fixed and gone from the run.
- `npm run test:properties`: 438 files, 1281 tests, green (one known-
  benign BL-871 unhandled-error pattern only).
- `node specs/pipeline/cli.js` on BL-1658's own feature: 25/25 pass.
- Each of the fourteen fixed handlers' own feature file run once: eleven
  fully green (BL-1146, BL-1253, BL-1322, BL-545, BL-697, BL-717, BL-718,
  BL-767, BL-790, BL-810, BL-894); three carry one pre-existing,
  unrelated, now-reported red each (BL-1384, BL-696 x2 features).
- Full census (`checkHandlerBudgets` with an empty allowlist over the
  real tree): zero violations among the twenty-two named handlers.

By coder.
