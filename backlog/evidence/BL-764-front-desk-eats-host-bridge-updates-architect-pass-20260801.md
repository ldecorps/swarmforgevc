# BL-764 architect pass — D1/D2/D3 rework verified, forwarded

## What was reviewed

Cleaner forwarded `cc84667218` (merge of coder `d943d6768`/`7ebd0e6c23`
["property-test the two remaining declared invariants"] and coder
`cc8466721`/`fbd2dc12bb` ["cover the untested callback_query bridge-topic
exclusion (D3)"], dedupe-cleaned), on top of `d62135aee`. This is the coder's
response to all three findings in
`BL-764-front-desk-eats-host-bridge-updates-bounce-20260801.md`. No
production code changed in this rework — test files only.

## D1 — invariant #1 (single getUpdates caller) property test

`extension/test/telegramCursorBridgeCore.property.test.js`: drives
`shouldUseCursorBridgeInboundQueue` across the full flag/token input space
(arbitrary flag strings, not just `'0'`/`'1'`; arbitrary tokens). Read against
the implementation (`telegramCursorBridgeCore.ts:255-271`): the property's
three branches (forced-on, forced-off, default-tracks-exclusive-token) match
the source exactly. Verified non-vacuous: removed the
`CURSOR_BRIDGE_BOT_TOKEN` fallback branch from the source (`return true`
unconditionally) — property failed immediately (`expected false, got true`);
restored, re-ran clean.

## D2 — invariant #2 (bridge-owned update forwarded-or-dropped, never SUP/Operator) property tests

`extension/test/telegramFrontDeskBotCore.property.test.js` adds two
properties:
- `decideCursorBridgeExclusion` drops iff the update's topic is in
  `[cursorTopicId, bubbleTopicId]`, for any owned-topic combination and any
  candidate topic id.
- `pollAndForward` never routes an owned-topic update to SUP/Operator, for
  any Host/Bubble topic config and any forward outcome (wired-ok/wired-fail/
  unwired) — `postToBridge`/`openSubjectAndRecord`/`postOperatorContext` are
  wired to *throw* if invoked, so a misroute fails the property loudly rather
  than needing a manual assertion to catch it. Exactly one of
  posted/dropped/failed is asserted per run (no update lost, none
  double-counted).

Both properties currently exercise `message`-shaped updates only (`cbUpdate`
builds `message.message_thread_id`); the callback_query path is D3's
coverage, not this pair's. That division is fine — together they cover the
decision space the bounce asked for.

## D3 — callback_query bridge-topic exclusion coverage

`extension/test/telegramFrontDeskBotCore.test.js` adds 5 examples: the
`decideCursorBridgeExclusion` fallback-to-`callback_query.message.
message_thread_id` read (since `topicIdOf` doesn't read `callback_query` at
all), plus `pollAndForward` end-to-end for Host callback_query forward,
Bubble callback_query forward, forward failure (parks as `failed`, not
dropped), and drop-when-unwired — each asserting `answerCallbackQuery`/
`recordApprovalReply`/`recordRejectionReply` (the SUP/Operator dispatch
adapters) are never called. Verified non-vacuous: removed the
`callback_query` fallback from `decideCursorBridgeExclusion` — the new
example test failed immediately (`expected 'drop', got 'not-applicable'`),
and all 4 downstream `pollAndForward` examples correctly skipped (mocha
`.skip`-on-first-failure is vitest's normal behavior, not a masking issue —
re-ran the fallback test alone to confirm the fail); restored source,
re-ran clean (357/357 in the file).

## Checks run

- `node extension/out/tools/dependency-gate.js` on the 3 changed test files
  (from `extension/`): **PASSED**, no forbidden edges.
- `node extension/out/tools/co-change-report.js` on the 3 changed files:
  expected clustering (own source file, existing test-file neighbors);
  nothing new/unexpected.
- `npm run test:properties`: 33/34 files, 100/101 tests green. The one
  failure (`test/bounceNaturalKey.property.test.js`, a BL-635 property with
  no fixed `numRuns`) is a **pre-existing, unrelated flake** — not touched by
  this parcel's diff, re-run in isolation passes clean. It's a probabilistic
  generator-coverage assertion (`assertPairCoverage`) that occasionally
  doesn't hit its rarest category within the default 100 runs. Flagged to
  coordinator by `note`, not bounced — outside BL-764's scope entirely.
- `npx vitest run` on all 7 BL-764-touched test files: 805/805 pass.
- Acceptance: `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-764-front-desk-eats-host-bridge-updates.feature`: 7/7
  green.
- Architecture boundaries: unchanged from the prior pass (no production code
  in this rework) — still N/A/clean, no webview code touched.

## Blocked checks

None.

Disposition: all three D1-D3 findings resolved with non-vacuous coverage.
Forwarded to hardener.

By architect.
