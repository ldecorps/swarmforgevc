# BL-607 — architect SEND BACK: refactor breaks the build (52 compile errors)

**Verdict:** SEND BACK to coder. The parcel does **not compile**. `npm run
compile` fails with 52 TypeScript errors and the entire extension fails to
build. A non-building tree cannot proceed to the hardener (mutation, coverage,
CRAP) or QA — those gates require a tree that compiles and runs its tests.

## Root cause

The cleaner's refactor commit `acd8c33c2` ("extract topic decision logic into
telegramTopicDecisions module") **moved ~36 exported symbols out of
`extension/src/tools/telegramFrontDeskBotCore.ts` into the new
`extension/src/tools/telegramTopicDecisions.ts`**, and
`telegramFrontDeskBotCore.ts` now *imports* them for its own use (lines ~30–56)
but **does not re-export them**.

`telegramFrontDeskBotCore.ts` was a barrel/public interface: **10 other modules
import those symbols *from it***. Moving the definitions out without a re-export
(and without repointing the consumers) severed that interface. Every consumer
now fails with `TS2459: declares '<X>' locally, but it is not exported` (or
`TS2724: has no exported member named '<X>'`).

## Impact — 10 consumer files, 52 errors

```
src/tools/telegram-front-desk-bot.ts      (29)   <- the BL-607 CLI itself
src/tools/notify-resident-spy-tunnel.ts    (5)
src/onboarding/negotiationTelegramRouting.ts (4)
src/tools/recreate-bl-topic.ts             (3)
src/tools/notify-babysitter.ts             (3)
src/tools/resume-expired-pauses.ts         (2)
src/tools/notify-dead-letters.ts           (2)
src/extension.ts                           (2)
src/onboarding/telegramChannelProvisioning.ts (1)
src/onboarding/negotiationTelegramRelay.ts (1)
```

## Symbols moved out of `telegramFrontDeskBotCore` but not re-exported

Topic constants: `APPROVALS_SUBJECT_ID`, `APPROVALS_TOPIC_NAME`,
`RECERT_SUBJECT_ID`, `RECERT_TOPIC_NAME`, `AGENT_QUESTIONS_SUBJECT_ID`,
`AGENT_QUESTIONS_TOPIC_NAME`, `BACKLOG_SUBJECT_ID`, `BACKLOG_TOPIC_NAME`,
`CONTROL_SUBJECT_ID`, `CONTROL_TOPIC_NAME`, `BABYSITTER_SUBJECT_ID`,
`BABYSITTER_TOPIC_NAME`, `RESIDENT_SPY_SUBJECT_ID`, `RESIDENT_SPY_TOPIC_NAME`,
`OPERATOR_SUBJECT_ID`, `OPERATOR_TOPIC_NAME`, `DEFAULT_SUBJECT_KEY`.

Decide/helper functions: `decideEnsureOperatorTopicAction`,
`decideStandingTopicTitleSync`, `decideEnsureApprovalsTopicAction`,
`decideEnsureRecertTopicAction`, `decideEnsureAgentQuestionsTopicAction`,
`decideEnsureBacklogTopicAction`, `decideEnsureControlTopicAction`,
`decideEnsureBabysitterTopicAction`, `decideEnsureResidentSpyTopicAction`,
`decideEnsureRoleTopicAction`, `decideAgentQuestionsReplyAction`,
`nextUpdateOffset`, `isFromPrincipal`, `isFromMyChat`, `topicIdOf`,
`messageTextOf`, `subjectForTopic`, `topicForSubject`, `resolveReplyDelivery`.

(Reproduce with `cd extension && npm run compile`.)

## Remediation (coder's choice of shape; either restores a green build)

1. **Minimal, preserves the established interface (recommended):** have
   `telegramFrontDeskBotCore.ts` re-export the extracted symbols the barrel used
   to expose, e.g. `export { APPROVALS_TOPIC_NAME, decideEnsureRecertTopicAction,
   /* … */ } from './telegramTopicDecisions';` (or turn the relevant part of its
   existing `import { … } from './telegramTopicDecisions'` block into a re-export
   so callers keep resolving them through `telegramFrontDeskBotCore`). Fixes all
   10 consumers with zero consumer edits.
2. **Alternative:** repoint each of the 10 consumers to import directly from
   `telegramTopicDecisions`. Larger diff, but a cleaner long-term boundary if the
   intent is that `telegramTopicDecisions` becomes the canonical import site.

Whichever you pick: `npm run compile` must be green and the unit suite must pass
before re-forwarding.

## What is NOT the problem (so you don't over-correct)

- **Dependency-rule hard gate PASSED** — I ran
  `node out/tools/dependency-gate.js` on the three changed TS source files
  (`telegram-front-desk-bot.ts`, `telegramFrontDeskBotCore.ts`,
  `telegramTopicDecisions.ts`): *no forbidden edges*. The extraction's
  dependency **direction** is fine; the new module is an acceptable boundary.
  The only defect is the **severed re-export interface** above. You do not need
  to undo the extraction — just restore the interface.
- No architectural layering violation (host I/O still lives in the extension
  host; the new module is a pure decision module).

Because the tree does not compile, the remaining architect passes (co-change
review, property-test assessment) were not run — they will run on the rebuilt,
compiling parcel when it returns.

— By architect.
