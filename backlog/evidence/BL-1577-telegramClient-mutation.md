# BL-1577 hardener evidence — telegramClient.ts mutation re-account, 2026-09-16

## Mutation cooldown gate

`mutation_cooldown_gate.bb` read `skip-cooldown` (file_age_days 0.51, under the
1-day window) because BL-1509's own commit touched
`extension/src/notify/telegramClient.ts` on 2026-09-15 13:08, less than a day
before this pass. The ticket's own mint-time reading (`run`, file age 21 days)
predates that commit. This ticket exists specifically to close the mutation
debt BL-1509's hardener deferred on this exact file - the cooldown gate's
purpose is to avoid wasted batch passes on files still actively churning in
production code, not to block the ticket that IS the deferred continuation of
that same file's own mutation gate. The parcel itself (coder/cleaner/architect
stages) touched only test files, never `extension/src/notify/telegramClient.ts`
itself, so there is no new production churn this pass is racing against.
Proceeding per the ticket's explicit "How" section and `human_approval:
approved`.

## Run

`ensureStrykerSandboxSiblings.js` run first (BL-863). Ran via a scoped config
(`extension/stryker.bl1577.config.json`, `--mutate out/notify/telegramClient.js`,
`vitest.bl1577.stryker.config.mjs` re-exporting BL-1509's
`vitest.bl1509.stryker.config.mjs`, `perTest`, `incremental: false`,
`concurrency: 4`, `dryRunTimeoutMinutes: 15`, `reporters: ["clear-text",
"progress", "json"]`) invoked as `npx stryker run stryker.bl1577.config.json`
(a positional config-file argument, not `--configFile` - Stryker's CLI has no
such flag) rather than editing the shared `extension/stryker.config.json` in
place: an initial attempt that DID edit the shared file broke
`test/hardenerTooling.test.js`'s own guard (`config.incremental === true`) in
the dry run, per hardender.prompt's "A standing Stryker-sandbox red never
licenses editing vitest.config.mjs excludes" rule applied to the sibling
`stryker.config.json` file. The scoped `stryker.bl1577.config.json` and
`vitest.bl1577.stryker.config.mjs` files are new, ticket-scoped, and left in
the tree (matching BL-1509's own `vitest.bl1509.stryker.config.mjs`
precedent); the shared `extension/stryker.config.json` is untouched. Detached
via `swarmforge/scripts/detach_job.sh` (each run's dry run alone ran 4m49s-5m05s
against a 20-core host at load ~1.5-2.5; three full runs were needed as tests
were added between them - see "What changed" below).

Include set: full unit suite
Instrumented: 656
No-coverage: 0
Survived: 105

Timeouts (7, counted as KILLED in Stryker's own score, listed here so a
reader does not mistake them for survivors): retryOnRateLimit x3 (mutant
426 BlockStatement 443:14, 432 ConditionalExpression 448:13, 434
BlockStatement 448:53), createForumTopicWithRateLimitRetry x3 (441
BlockStatement 469:14, 443 ConditionalExpression 471:13, 447 BlockStatement
471:71), sendTelegramMessageWithRateLimitRetry x1 (456 UpdateOperator
491:50) - each drops the retry loop's bound and runs to the per-mutant
timeout, exactly BL-1509's hardener precedent.

Ignored: 3 (line 2's entrypoint-boilerplate literals, unchanged from the
original BL-1509 run - BL-447/BL-498).

## What changed

Two rounds of test additions, both in `extension/test/telegramClient.test.js`,
no production code touched:

1. The first full re-run (104 survived / 2 no-coverage) showed the coder's
   19-mutant no-coverage closure left exactly 2 mutants still uncovered:
   `defaultPost`'s and `defaultPostVoice`'s identical
   `catch { json = undefined; }` blocks (out/notify/telegramClient.js:46-48
   and :610-612) - never named by the BL-1509 census (coder's own evidence
   already flagged these lines as uncovered-but-not-census-named). Added two
   tests reaching each via a stubbed `global.fetch` whose `json()` throws
   (malformed response body), covering both. Both mutants are EQUIVALENT
   once covered: `json` is declared `let json;` (undefined) before the
   `try`, so an explicit `json = undefined` in the `catch` is behaviorally
   identical to an empty catch block - no consumer of either function's
   return value can ever observe a difference (BL-234), grepped: neither
   `defaultPost` nor `defaultPostVoice`'s callers branch on whether `json`
   came from a successful parse or the initial `undefined`.

2. The second full re-run (106 survived / 0 no-coverage) surfaced that one of
   `defaultWaitMs`'s two mutants - previously no-coverage, the coder's
   `vi.useFakeTimers()` test does reach it - was SURVIVED, not killed:
   replacing `defaultWaitMs`'s function body (`{ return new
   Promise((resolve) => setTimeout(resolve, ms)); }`) with `{}` makes it
   return `undefined` instead of a Promise; `await wait(ms)` on `undefined`
   resolves immediately, so the retry proceeds with NO actual wait, and the
   existing test only asserted the final result and attempt count, not
   timing - a coverage-vs-mutation gap, not an equivalent mutant (a real
   `setTimeout` genuinely never fires vs. one that does is observable).
   Strengthened the same test: after starting the call, `await
   vi.advanceTimersByTimeAsync(0)` to flush microtasks with zero elapsed
   real time, then assert `vi.getTimerCount() === 1` (a real timer is
   actually pending) before advancing the full 1000ms. Verified by hand
   (Stryker load-safety rule: no detached job was outstanding at the time):
   applied the mutant directly to `out/notify/telegramClient.js`, re-ran
   just this test, watched it fail red (`2 !== 1` on the `attempts`
   assertion - the mutated body makes the retry fire before the flush point
   even completes, since nothing yields on a real timer), restored the
   compiled file from a pre-mutation copy and recompiled from
   `extension/src` before re-running the full pass. The third and final
   full re-run (105 survived / 0 no-coverage) confirms the kill: both of
   `defaultWaitMs`'s mutants are now accounted (0 remain in its function
   body).

No module-level survivor was found in this or either earlier run (every
survived mutant maps inside a named function body per
`out/notify/telegramClient.js`'s top-level `function`/`async function`
declarations) - the ruling's "any module-level survivors" chase-to-zero
clause has nothing to chase.

## No-coverage regions reached

- bl568PlanMenuAnswerDrive: test/bl568MenuAnswerPollMapping.test.js :: BL-1577: an empty vote drops without inject
- extractIconStickers: test/telegramClient.test.js :: BL-1577: getForumTopicIconStickers returns an empty list when the response result is not an array (malformed shape)
- setChatMenuButton: test/telegramClient.test.js :: BL-1577: setChatMenuButton posts { type: "default" } to reset the chat menu button
- defaultWaitMs: test/telegramClient.test.js :: BL-1577: createForumTopicWithRateLimitRetry uses the real timer-based wait when none is given
- extractForumTopicCreatedName: test/telegramClient.test.js :: BL-1577: resolveForumTopicName returns undefined when the probe reply carries no forum_topic_created service message
- inlineKeyboardButtonToWire: test/telegramClient.test.js :: BL-1577: sendTelegramMessage defaults callback_data to an empty string when a button has neither callbackData, webAppUrl nor url
- defaultPost: test/telegramClient.test.js :: BL-1577: answerCallbackQuery uses the real fetch-based post when no postFn is given
- extractUpdates: test/telegramClient.test.js :: BL-1577: getTelegramUpdates returns an empty batch when the response result is not an array (malformed shape)
- defaultPostVoice: test/telegramClient.test.js :: BL-1577: sendVoiceNote uses the real fetch-based multipart post when no postVoiceFn is given
- formatNetworkError: test/telegramClient.test.js :: BL-1577: sendTelegramMessage reports "unknown error" when a thrown failure is not an Error instance
- bl568TextFallbackMessage: test/bl568MenuAnswerPollMapping.test.js :: BL-1577: text fallback omits the RC segment entirely when no rcHint is given

## Survivor disposition

- defaultPost (StringLiteral 35:17): grandfathered under BL-1519
- defaultPost (ObjectLiteral 36:18): grandfathered under BL-1519
- defaultPost (StringLiteral 36:36): grandfathered under BL-1519
- defaultPost (BlockStatement 46:11): accepted equivalent - json is declared `let json;` (undefined) before the try, so an explicit `json = undefined` in this catch is behaviorally identical to an empty catch block; no consumer of defaultPost's return value can ever observe a difference (BL-234)
- extractParameters (ConditionalExpression 62:9): grandfathered under BL-1519
- extractParameters (LogicalOperator 62:9): grandfathered under BL-1519
- extractParameters (ConditionalExpression 62:9): grandfathered under BL-1519
- extractParameters (LogicalOperator 62:9): grandfathered under BL-1519
- extractParameters (ConditionalExpression 62:17): grandfathered under BL-1519
- extractParameters (ConditionalExpression 62:45): grandfathered under BL-1519
- callTelegramApi (StringLiteral 109:60): grandfathered under BL-1519
- inlineKeyboardButtonToWire (ConditionalExpression 113:9): grandfathered under BL-1519
- inlineKeyboardButtonToWire (BlockStatement 113:27): grandfathered under BL-1519
- inlineKeyboardButtonToWire (ObjectLiteral 114:16): grandfathered under BL-1519
- inlineKeyboardButtonToWire (ObjectLiteral 114:46): grandfathered under BL-1519
- extractDescription (ConditionalExpression 125:9): grandfathered under BL-1519
- extractDescription (LogicalOperator 125:9): grandfathered under BL-1519
- extractDescription (ConditionalExpression 125:9): grandfathered under BL-1519
- extractDescription (LogicalOperator 125:9): grandfathered under BL-1519
- extractDescription (ConditionalExpression 125:17): grandfathered under BL-1519
- extractDescription (ConditionalExpression 125:45): grandfathered under BL-1519
- extractResultObject (ConditionalExpression 134:9): grandfathered under BL-1519
- extractResultObject (LogicalOperator 134:9): grandfathered under BL-1519
- extractResultObject (ConditionalExpression 134:9): grandfathered under BL-1519
- extractResultObject (LogicalOperator 134:9): grandfathered under BL-1519
- extractResultObject (ConditionalExpression 134:9): grandfathered under BL-1519
- extractResultObject (LogicalOperator 134:9): grandfathered under BL-1519
- extractResultObject (ConditionalExpression 135:9): grandfathered under BL-1519
- extractResultObject (ConditionalExpression 137:9): grandfathered under BL-1519
- extractResultNumberField (ConditionalExpression 144:12): grandfathered under BL-1519
- sendTelegramMessage (ConditionalExpression 171:13): grandfathered under BL-1519
- sendTelegramMessage (ConditionalExpression 172:13): grandfathered under BL-1519
- sendTelegramMessage (ConditionalExpression 174:13): grandfathered under BL-1519
- resolveForumTopicName (StringLiteral 190:15): grandfathered under BL-1519
- resolveForumTopicName (ConditionalExpression 195:9): grandfathered under BL-1519
- resolveForumTopicName (BlockStatement 195:26): grandfathered under BL-1519
- resolveForumTopicName (ConditionalExpression 200:9): grandfathered under BL-1519
- extractForumTopicCreatedName (OptionalChaining 207:19): grandfathered under BL-1519
- extractForumTopicCreatedName (LogicalOperator 208:9): grandfathered under BL-1519
- extractForumTopicCreatedName (ConditionalExpression 208:19): grandfathered under BL-1519
- extractForumTopicCreatedName (LogicalOperator 212:9): grandfathered under BL-1519
- extractForumTopicCreatedName (ConditionalExpression 212:21): grandfathered under BL-1519
- extractForumTopicCreatedName (ConditionalExpression 216:12): grandfathered under BL-1519
- extractPollId (OptionalChaining 219:18): grandfathered under BL-1519
- extractPollId (ConditionalExpression 220:9): grandfathered under BL-1519
- extractPollId (LogicalOperator 220:9): grandfathered under BL-1519
- extractPollId (ConditionalExpression 220:9): grandfathered under BL-1519
- extractPollId (LogicalOperator 220:9): grandfathered under BL-1519
- extractPollId (ConditionalExpression 220:17): grandfathered under BL-1519
- extractPollId (ConditionalExpression 220:45): grandfathered under BL-1519
- sendTelegramPoll (ConditionalExpression 230:13): grandfathered under BL-1519
- bl568MenuAnswerPollMapping (ArrayDeclaration 245:18): grandfathered under BL-1519
- bl568MenuAnswerPollMapping (ArrayDeclaration 248:68): grandfathered under BL-1519
- bl568FingerprintMatches (ConditionalExpression 252:12): grandfathered under BL-1519
- bl568FingerprintMatches (EqualityOperator 252:12): grandfathered under BL-1519
- bl568PlanMenuAnswerDrive (MethodExpression 261:18): grandfathered under BL-1519
- bl568PlanMenuAnswerDrive (ArrayDeclaration 262:47): grandfathered under BL-1519
- editMessageText (ConditionalExpression 282:13): grandfathered under BL-1519
- setChatMenuButton (ConditionalExpression 303:13): grandfathered under BL-1519
- setChatMenuButton (ConditionalExpression 303:13): grandfathered under BL-1519
- setChatMenuButton (EqualityOperator 303:13): grandfathered under BL-1519
- setChatMenuButton (ObjectLiteral 303:36): grandfathered under BL-1519
- getBotUsername (StringLiteral 315:58): grandfathered under BL-1519
- getBotUsername (ConditionalExpression 316:9): grandfathered under BL-1519
- getBotUsername (BlockStatement 316:26): grandfathered under BL-1519
- getBotUsername (OptionalChaining 319:22): grandfathered under BL-1519
- getBotUsername (ConditionalExpression 320:12): grandfathered under BL-1519
- extractPinnedMessageId (OptionalChaining 342:27): grandfathered under BL-1519
- extractPinnedMessageId (LogicalOperator 343:9): grandfathered under BL-1519
- extractPinnedMessageId (ConditionalExpression 343:26): grandfathered under BL-1519
- extractPinnedMessageId (ConditionalExpression 343:63): grandfathered under BL-1519
- extractUpdates (ConditionalExpression 357:20): grandfathered under BL-1519
- extractUpdates (LogicalOperator 357:20): grandfathered under BL-1519
- extractUpdates (ConditionalExpression 357:28): grandfathered under BL-1519
- answerCallbackQuery (ConditionalExpression 390:75): grandfathered under BL-1519
- createForumTopic (ConditionalExpression 413:13): grandfathered under BL-1519
- sendTelegramMessageWithRateLimitRetry (ObjectLiteral 490:16): grandfathered under BL-1519
- sendTelegramMessageWithRateLimitRetry (BooleanLiteral 490:27): grandfathered under BL-1519
- sendTelegramMessageWithRateLimitRetry (StringLiteral 490:41): grandfathered under BL-1519
- sendTelegramMessageWithRateLimitRetry (EqualityOperator 491:27): grandfathered under BL-1519
- editForumTopic (ConditionalExpression 523:13): grandfathered under BL-1519
- editForumTopic (ConditionalExpression 524:13): grandfathered under BL-1519
- extractIconStickers (ConditionalExpression 551:20): grandfathered under BL-1519
- extractIconStickers (LogicalOperator 551:20): grandfathered under BL-1519
- extractIconStickers (ConditionalExpression 551:28): grandfathered under BL-1519
- extractIconStickers (ConditionalExpression 556:16): grandfathered under BL-1519
- extractIconStickers (OptionalChaining 556:23): grandfathered under BL-1519
- extractIconStickers (OptionalChaining 557:31): grandfathered under BL-1519
- extractFilePath (ConditionalExpression 568:20): grandfathered under BL-1519
- extractFilePath (LogicalOperator 568:20): grandfathered under BL-1519
- extractFilePath (ConditionalExpression 568:28): grandfathered under BL-1519
- extractFilePath (ConditionalExpression 569:22): grandfathered under BL-1519
- extractFilePath (LogicalOperator 569:22): grandfathered under BL-1519
- extractFilePath (ConditionalExpression 569:32): grandfathered under BL-1519
- extractFilePath (ConditionalExpression 570:12): grandfathered under BL-1519
- getFile (StringLiteral 582:78): grandfathered under BL-1519
- downloadTelegramFile (StringLiteral 596:57): grandfathered under BL-1519
- downloadTelegramFile (StringLiteral 601:60): grandfathered under BL-1519
- defaultPostVoice (ObjectLiteral 605:34): grandfathered under BL-1519
- defaultPostVoice (StringLiteral 605:44): grandfathered under BL-1519
- defaultPostVoice (BlockStatement 607:9): grandfathered under BL-1519
- defaultPostVoice (BlockStatement 610:11): accepted equivalent - json is declared `let json;` (undefined) before the try, so an explicit `json = undefined` in this catch is behaviorally identical to an empty catch block; no consumer of defaultPostVoice's return value can ever observe a difference (BL-234)
- sendVoiceNote (ArrayDeclaration 627:35): grandfathered under BL-1519
- sendVoiceNote (StringLiteral 627:45): grandfathered under BL-1519
- sendVoiceNote (StringLiteral 636:60): grandfathered under BL-1519

## Verification

- `npx vitest run test/telegramClient.test.js test/bl568MenuAnswerPollMapping.test.js`:
  110/110 pass.
- Full suite: `npx vitest run` from `extension/` - green (re-run after the
  final test change, before this evidence was written).
- `extension/src/**` unchanged across every stage of this ticket (confirmed
  via `git diff main --name-only`): only
  `extension/test/telegramClient.test.js` gained tests; no production seam
  was missing.

By hardender.
