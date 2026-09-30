# BL-1732 — coder bounce fix, 2026-09-30 (cleaner bounce, evidence e7b4428c7e)

## What changed

Wires the Intake topic live, closing the scope gap the cleaner's bounce
named: the pure decision layer (`decideEnsureIntakeTopicAction`,
`decideIntakeTopicReply`, both pre-existing, untouched) is now actually
reached by the live bot.

- `extension/src/tools/telegram-front-desk-bot.ts`:
  - `ensureIntakeTopic` (mirrors `ensureAgentQuestionsTopic`'s
    reuse-or-create/idempotent-across-restarts shape exactly - no rebind
    history to reconcile, same as the Intake subject's own decide
    function). Called once before the poll loop starts, alongside every
    other standing topic's own `ensure*` call.
  - `resolveLiveIntakeFormUrl` (exported for direct testing): reads the
    SAME persisted tunnel state `notify-resident-spy-tunnel.ts` writes on
    every rotation (`resident-spy-tunnel-notify.json`'s `liveUrl`), and
    reuses its base+token to build the `/intake-form` URL through
    `buildIntakeFormUrl` (the one owner of that shape - BL-1811). No
    file, no `liveUrl`, a malformed file, or a `liveUrl` with no
    bearer/token token all resolve to `undefined` - the exact "tunnel is
    down" shape `decideIntakeTopicReply` already turns into the
    unreachable-and-why reply (scenario 05), never a crash.
  - `buildPollAdapters` wires `notifyIntakeTopic` (posts into the topic,
    same `sendTelegramMessage` shape as `notifyRecertTopic`) and
    `resolveIntakeFormUrl` (calls the resolver above).
- `extension/src/tools/telegramFrontDeskBotCore.ts`: a new
  `BotUpdateDecision` variant `intake-topic-reply` (no verb to parse -
  every principal message in the topic gets the same reply, unlike
  Approvals/Recert's own multi-variant replies); `decideReservedSubjectReplyAction`
  routes `INTAKE_SUBJECT_ID` to it; `deliverIntakeTopicReply` resolves the
  live form URL through the adapter, calls the pure
  `decideIntakeTopicReply`, and posts the result - always `'posted'`
  (there is no underlying write to fail the way Approvals/Recert's own
  record-then-notify replies can); wired into `deliverReservedSubjectReply`.
  Two new optional `PollAdapters` fields (`notifyIntakeTopic`,
  `resolveIntakeFormUrl`), same degrades-to-no-op posture as every other
  optional adapter in this file - a pre-existing `PollAdapters` fixture
  keeps working unchanged.
- `extension/src/concierge/residentSpyTunnelNotify.ts`:
  `buildIntakeFormUrl(baseUrl, token)`, the same base+token->URL shape as
  the pre-existing `buildResidentSpyMiniAppUrl`/`buildConsoleMiniAppUrl` -
  one owner for "how a bridge route URL is built from the live tunnel".
- The Intake topic's own inbound routing inherits the SAME
  `checkUpdateEligibility` chat/principal guard every other reserved
  subject already goes through (checked before subject dispatch) - no
  new code needed for invariant 2's "the Intake topic ignores everyone
  else" half.

## A second defect found running the mandatory property lane

`npm run test:properties` (run once before this forward, per the
2026-09-17 test-lane rule) failed
`bl1732VocabularyPromotionInvariant.property.test.js` - not a flake:
`fc.string()` had generated a value carrying a backslash or an embedded
newline, and `intakeVocabularyStore.ts`'s hand-rolled scalar-list
render/parse (pre-existing, from the ORIGINAL BL-1732 pass, untouched by
this bounce's own scope) loses or corrupts such a value on the read-back
round-trip:
- `renderVocabulary` escaped only `"`, never `\` itself - a value ending
  in a backslash made the escaped closing-quote sequence ambiguous with
  an escaped literal quote, and `parseVocabulary`'s per-line regex then
  consumed past the real closing quote, dropping the line.
- A real newline inside a value split ONE logical entry across TWO
  physical lines - `parseVocabulary` reads line-by-line and can never
  rejoin them.

Fixed in `intakeVocabularyStore.ts`: `escapeVocabValue`/`unescapeVocabValue`
escape the backslash FIRST (so a later literal `"`/`n`/`r` is never
misread as part of an earlier escape), then `"`, then encode newlines/
carriage returns as the two-character `\n`/`\r` sequences so every entry
stays on its own physical line. `renderVocabulary`/`parseVocabulary` call
these instead of the ad hoc single `.replace()` calls they had.
`test/intakeVocabularyStore.test.js` gets four new regression cases
(bare backslash, trailing backslash, embedded newline, embedded carriage
return) - each verified non-vacuous by hand (fails against the pre-fix
implementation, restored). This is coder-domain production-code work on
the SAME ticket, found while verifying my own bounce fix, not a
different ticket's standing red to hand off (Article 4.2's own-ticket
scope, `swarmforge/roles/coder.prompt`'s red-ownership rule is for a red
NOT belonging to the parcel in hand).

## Verification

- `cd extension && npm run compile`: clean.
- `cd extension && npx vitest run test/telegramFrontDeskBotCli.test.js test/telegramFrontDeskBotCore.test.js test/residentSpyTunnelNotify.test.js test/intakeTopicDecisions.test.js`:
  802 tests, all pass (22 new: 6 `ensureIntakeTopic`, 6
  `resolveLiveIntakeFormUrl`, 6 pure-decide, 3 delivery, 1
  `buildIntakeFormUrl`).
- `cd extension && npx vitest run test/intakeVocabularyStore.test.js test/intakeWriter.test.js`:
  24 tests, all pass (4 new backslash/newline/CR regression cases).
- `node specs/pipeline/cli.js specs/features/BL-1732-the-intake-topic-opens-a-form-that-files-an-intake.feature`:
  10 of 10 ok (unchanged - the acceptance drives the pure decision layer
  directly, per the ticket's own constraint; this pass adds no new
  scenario, only makes the existing decisions reachable live).
- `cd extension && npm test`: 643 files, 10954 tests, all green.
- `cd extension && node out/tools/dependency-gate.js`: PASSED, no
  forbidden edges.
- `cd extension && npx vitest run --config vitest.properties.config.mjs test/bl1732VocabularyPromotionInvariant.property.test.js test/bl1732IntakeAuthInvariant.property.test.js`
  five times in a row post-fix: all pass (invariant 2, the auth guard, was
  never touched and never failed).
- `cd extension && npm run test:properties` (the full lane, the actual
  failure surface that first caught this): pre-fix, 1 failed | 1377
  passed (481 files), `bl1732VocabularyPromotionInvariant` failing on
  `after[promotedSlot].includes(promotedValue.trim())`. Post-fix, re-run
  in full: 481 files, 1378 tests, all pass (3 `[vitest-worker]: Timeout
  calling "onTaskUpdate"` errors - the allowlisted BL-871 benign noise,
  not a failure).

By coder.
