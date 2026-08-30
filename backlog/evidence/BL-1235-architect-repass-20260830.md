# BL-1235 — architect re-pass after bounce, 2026-08-30

Reviewed the coder's answer to my own bounce (`eee0e843f`, merged via
cleaner `7ac5c7daa4`), merged into architect as `7ab9582cd` + my own fix
commit `709a87865`.

## D1 — the live turn loop

Re-grepped `extension/src` for every export `localQwenSeat.ts` offers: now
four files reference it (`localQwenSeat.ts`, `localQwenSeatLive.ts`,
`telegramCursorBridgeCore.ts`, `telegramCursorBridgeLive.ts`), where before
there were two. Read the wiring directly:

- `localQwenSeatLive.ts` performs the I/O `localQwenSeat.ts`'s docstring
  always said belonged to "the caller": `readQwenLocalTopicId` resolves the
  seat's topic from the SAME `cursor-bridge-topic-map.json` cursor and
  Bubble already use; `readLocalEndpoint` probes `/api/tags`;
  `completeWithLocalModel` calls non-streaming `/api/generate`;
  `runLocalSeatTurn` is the whole turn with every edge (endpoint, completion,
  post, clock) injected — no real network in tests.
- `telegramCursorBridgeLive.ts`'s `processInboundUpdates` checks
  `deps.qwenLocalTopicId` and handles a matching message BEFORE
  `decideInboundAction` (cursor's own decision) is even called, then
  `continue`s — cursor is structurally never consulted about that topic, not
  merely filtered afterward. `runCursorBridgeApp` wires
  `qwenLocalTopicId: readQwenLocalTopicId(env.repoRoot)` by default.
- Runs INSIDE the existing poll (no second `getUpdates` consumer, which
  would 409 and take the front desk down) — confirmed by reading the diff:
  no new poll loop was added, only a branch inside the existing one.

This is genuinely reachable now: an inbound message in the seat's bound
topic reaches `runLocalSeatTurn` on every real poll tick.

## D2 — the flaky reach floor

Fixed by construction, not by raising `numRuns`: `KIND_CASES` now supplies
one deliberately-constructed input per decision kind (`answer`, `refuse`,
`not-mine`), each asserted with its own `fc.assert`/`numRuns: 10`, so the
reach floor cannot miss. The old uniform-draw breadth check is kept as a
separate test with no floor. Reran the property file 8 times back to back:
8/8 green (previously ~13% failure rate, reproduced 1-in-6 during my
bounce).

## A defect this pass introduced and caught before forwarding

My own merge (`7ab9582cd`, auto-resolved with no conflict) silently DROPPED
`require('./bl1235LocalQwenSeatSteps')` from
`specs/pipeline/steps/index.js` — my side had removed that line during the
earlier bounce-revert, and the 3-way merge did not recognise the coder's
re-add as content to keep. Acceptance went from 5/5 to 0/5, every scenario
failing "no step handler matched". Caught by re-running acceptance rather
than trusting the merge; fixed directly in `709a87865` (the require line
restored, ordering preserved). Re-ran acceptance after the fix: 5/5.

## Other checks

- `cd extension && npx tsc -p .` — clean.
- `npx vitest run test/bl1235LocalQwenSeat.test.js
  test/bl1235LocalQwenSeatLive.test.js test/telegramCursorBridgeLive.test.js
  --config vitest.config.mjs` — 154/154 green.
- `npx vitest run test/bl1235LocalQwenSeatInvariants.property.test.js
  --config vitest.properties.config.mjs` — 6/6, and reran 8x for D2's own
  claim.
- `node extension/out/tools/dependency-gate.js src/tools/localQwenSeat.ts
  src/tools/localQwenSeatLive.ts src/tools/telegramCursorBridgeCore.ts
  src/tools/telegramCursorBridgeLive.ts` — PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js
  src/tools/localQwenSeatLive.ts src/tools/telegramCursorBridgeLive.ts` —
  ordinary, already-updated companions only. No action.
- `required_wiring`: both anchors present — `QWEN_LOCAL_SUBJECT_ID` in
  `telegramCursorBridgeCore.ts`, `bl1235LocalQwenSeatSteps` registered in
  `specs/pipeline/steps/index.js` (after the merge-drop fix above).

## Disposition

No violation, no correctness defect found in the parcel itself this pass —
the one defect found (the dropped registration) was introduced by my own
merge, not the coder's commit, and is already fixed and verified above.
Forwarded to hardender.
