# BL-1235 — architect bounce, 2026-08-30

Reviewed commit `74ffad60a` (coder `5d8fcd6fa` + cleaner's dedup
`74ffad60a`, merged into architect as `8f07c3b1e`).

## Review inventory

- **Dependency-rule gate** (`node extension/out/tools/dependency-gate.js
  src/tools/localQwenSeat.ts src/tools/telegramCursorBridgeCore.ts`):
  PASSED, no forbidden edges.
- **Co-change report**: `telegramCursorBridgeCore.ts` is heavily coupled
  (18-28 co-changes) to `telegramCursorBridgeLive.ts` and
  `telegram-front-desk-bot.ts` — the files that actually dispatch inbound
  Telegram events — and this parcel touched neither. Corroborates D1 below;
  informational only, the tool never auto-bounces.
- **Two-layer / host-owns-IO / no browser storage / secrets / integrate-not-
  fork boundaries**: unaffected — no webview/UI, no direct process spawn,
  no secrets handling in this parcel.
- **Declared invariants (2)**: both have property-test coverage in
  `extension/test/bl1235LocalQwenSeatInvariants.property.test.js`. Invariant
  1 (topic isolation) is solid. Invariant 2 has a flakiness defect — D2
  below.
- **required_wiring**: both anchors present —
  `QWEN_LOCAL_SUBJECT_ID`/`QWEN_LOCAL_TOPIC_NAME` defined alongside
  `CURSOR_REMOTE`/`BUBBLE` in `telegramCursorBridgeCore.ts`, and
  `specs/pipeline/steps/index.js` registers `bl1235LocalQwenSeatSteps`. Both
  are real and correct as far as they go, but see D1 — required_wiring only
  checked that the subject id and acceptance handler exist, not that
  anything in the live bot actually consumes them.
- **Correctness read**: D1, D2 below.

## D1 — the seat is entirely unreachable in production; the "turn loop" the
ticket commissions was never built

The ticket's own "How" section: *"The turn loop then sends the topic's
message to the local endpoint and posts the completion back into the same
topic."* And `qa_e2e_procedure` step 2: *"Post a message in topic 41004 and
confirm the reply comes back in that topic and is visibly from the local
model."* Neither is possible today.

`localQwenSeat.ts`'s own docstring says the split deliberately: *"Everything
here is PURE: a decision in, a decision out. The Telegram I/O, the endpoint
probe and the completion call all live in the caller, which is the same
split every other bridge decision module uses."* That caller does not
exist. Grepped the whole of `extension/src` for every export this module
offers:

```
$ grep -rln "QWEN_LOCAL\|localQwenSeat\|decideLocalSeatTurn" extension/src
extension/src/tools/localQwenSeat.ts
extension/src/tools/telegramCursorBridgeCore.ts
```

Only the module itself and the subject-id declaration. Nothing in
`extension/src/tools/telegram-front-desk-bot.ts` (the live front-desk
dispatcher) or `extension/src/tools/telegramCursorBridgeLive.ts` (the live
cursor-bridge poll loop, `runCursorBridgePollOnce`/`runCursorBridgeLoop`)
imports or calls any of `qwenLocalTopicIdFromMap`, `decideLocalSeatTurn`,
`formatLocalSeatRefusal`, `formatLocalSeatAcknowledgement`, or
`resolveLocalSeatModelId`. Compare to the pattern this ticket says to
follow: `telegram-front-desk-bot.ts` has `readCursorBridgeTopicId` /
`readBubbleTopicId` (lines 372-403) which resolve `CURSOR_REMOTE`'s and
`BUBBLE`'s live topic ids and feed the actual dispatch — there is no
`readQwenLocalTopicId` counterpart, and nothing calls the ollama completion
endpoint (`http://127.0.0.1:11434/...`) for this seat anywhere outside a
test file.

So even with the operator's live topic-map binding written today (the one
thing the evidence file names as the sole remaining step — "The live
binding... is runtime operator state... writing the live file is an
operational step"), posting a message in topic 41004 does nothing: no code
path reads that topic id at runtime, calls `decideLocalSeatTurn` on the
inbound message, or performs the actual model completion + post-back. This
is not the "operational run, not a build" class the ticket's
`out_of_scope` names (installing ollama, choosing the tag) — it is
application wiring the ticket's own description commissions, verified
absent by grep, not inferred.

The acceptance suite (5/5) and property tests (verified below) do not catch
this because every scenario drives `decideLocalSeatTurn` directly
(`specs/pipeline/steps/bl1235LocalQwenSeatSteps.js`'s own header: "Every
scenario drives the REAL decision... over the topic map's actual shape") —
none of them go through the live bot's actual inbound-message dispatch, so
a decision function with zero callers reads as fully tested.

**Remediation**: add the caller `localQwenSeat.ts`'s own docstring
describes — most naturally beside `runCursorBridgePollOnce`/
`runCursorBridgeLoop` in `telegramCursorBridgeLive.ts` (the live poll loop
already walks inbound Telegram updates per topic) or wherever the live bot
resolves `CURSOR_REMOTE`/`BUBBLE` topic ids today
(`telegram-front-desk-bot.ts:372-403`): resolve `QWEN_LOCAL`'s live topic id
the same way, route an inbound message in that topic through
`decideLocalSeatTurn`, perform the actual ollama completion call on
`answer`, and post either the completion or `formatLocalSeatRefusal`/
`formatLocalSeatAcknowledgement` back into the topic. This is implementation,
not a spec gap — the ticket's own description already specifies the shape.

## D2 — a property test's reach-floor assertion is flaky (under-provisioned
generator, not a fixed defect in the test's premise)

`extension/test/bl1235LocalQwenSeatInvariants.property.test.js`, "BL-1235
invariant 2... offers no decision a caller could route to another seat on"
(line ~197). Reproduced by running the file six times back to back
(`cd extension && npx vitest run
test/bl1235LocalQwenSeatInvariants.property.test.js --config
vitest.properties.config.mjs`): 1 failure, 5 passes. This is deterministically
flaky, not a one-off — I ran it enough times to tell the two apart, per the
project's own "say flaky or deterministic only from evidence" rule.

First failure's own output:
```
FAIL  ... > offers no decision a caller could route to another seat on
Error: reach floor: decision kind answer drawn 0 < 1
```

Cause, from reading the generator: the test draws `topicId` uniformly from
5 `SURFACES`, `endpointArb` uniformly from 4 fixed shapes (only 1 of which
is `healthy` with a catalogue containing the model), and `modelId` uniformly
from 3 constants (only 1 of which is the model the catalogue holds). An
`answer` decision needs all three draws to land on their one matching value
simultaneously: `P(answer) = 1/5 × 1/4 × 1/3 = 1/60`. Over `numRuns: 120`,
the expected count is 2, but `P(zero hits) = (59/60)^120 ≈ 13%` — a
one-in-eight chance of failing on any given run, matching what six runs
showed. The property itself is correct and the fix belongs in the
generator's reach, not the assertion: either raise `numRuns` enough to make
zero-hits negligible, or (cleaner) draw `topicId`/`modelId`/`endpointArb`
so the `answer` case is deliberately weighted or guaranteed at least once
per run, the same way invariant 2's own `CAUSE_FLOOR` loop above it forces
each refusal cause by iterating `REFUSAL_CAUSES` explicitly rather than
hoping a uniform draw finds it.

**Remediation**: `extension/test/bl1235LocalQwenSeatInvariants.property.test.js`,
the `'offers no decision...'` test — raise reach for the `answer` case
(explicit inclusion the way the sibling test above it iterates
`REFUSAL_CAUSES`, or a large enough `numRuns`) so the assertion is not
sensitive to fast-check's per-run seed.

## Disposition

Both defects are in-parcel (D1 the ticket's own commissioned wiring never
built, D2 a flaky assertion in the parcel's own new property test) — bounced
to the coder rather than forwarded to the hardener.
