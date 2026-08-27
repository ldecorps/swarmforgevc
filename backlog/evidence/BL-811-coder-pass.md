# BL-811 — coder pass

Review-and-fix ticket over the Host queue starvation hotfix (`2b8d19d1`,
committed directly to `main` by the specifier under BL-506, not pipeline-
reviewed). This pass: confirms/refutes the two specifier-found leads
(`review_findings`), fixes the confirmed defect, writes the acceptance step
handlers the ticket's own `acceptance:` field requires, and authors the
declared-invariant property tests (BL-654).

## D1 — vote retraction wiping the queue (CONFIRMED, fixed)

Reproduced before fixing: a poll persisted by a pre-hotfix build has no
`clearAllOptionIndex` field (`parseQueuedPromptPoll` only sets it when the
persisted value is a number). Telegram sends `option_ids: []` on a vote
retraction, so `selectedIndex` is `undefined`. The original comparison
(`selectedIndex === pendingPoll.clearAllOptionIndex`) let `undefined ===
undefined` through, clearing the entire queue on any retraction against such
a legacy poll — invariant 2 ("departures remain explicit and auditable")
violated: the departure was receipted, but nobody chose it.

**Fix** (`extension/src/tools/telegramCursorBridgeLive.ts`,
`processQueuedPollAnswer`): the clear-all branch now requires
`typeof pendingPoll.clearAllOptionIndex === 'number'` before comparing.
Extracted the whole decision (`select` / `clear-all` / `ignore`) into a new
pure, exported function, `decideQueuedPollAnswerAction`
(`extension/src/tools/telegramCursorBridgeCore.ts`) — Core is this project's
home for pure decision logic (mirrors `decideInboundAction`,
`decidePollAnswerAction`), and pulling the fixed branch out of the I/O-heavy
handler is what makes it directly property-testable (see below) rather than
only reachable through the full `runCursorBridgePollOnce` path.

**Non-vacuity, proven twice:**
- Manual probe against the unmodified hotfix tree (`git stash` on both
  touched files): a retraction (`option_ids: []`) against a poll with no
  `clearAllOptionIndex` field wiped a 1-item queue to `[]`. Restoring the fix
  and re-running the identical probe: the queue survives unchanged.
- The property test itself (below) was run against a deliberately
  reintroduced D1 (dropping the `typeof` guard) and failed with the exact
  counterexample shape (`clearAllOptionIndex: undefined`, `selectedIndex:
  undefined`) before being restored.

## D2 — two changes riding along with no ticket of their own (REFUTED as a scope problem; both confirmed intended)

**`/pause` `/resume` help text, `/stop` `/start` added to the hard-confirm
line.** Checked whether these are new, unreviewed commands: `SOFT_VERBS`
(`/pause`, `/resume`, …) and `HARD_VERBS` (`/stop`, `/start`, …) in
`extension/src/tools/telegramCursorOperatorCore.ts` were **not** touched by
the hotfix commit (`2b8d19d1` diff only touches
`telegramCursorBridgeCore.ts` and `telegramCursorBridgeLiveness.ts`) — they
were already shipped and pipeline-reviewed in `f9b38f53` ("Land Cursor
Remote operator slices BL-700–704"), predating this hotfix. `formatHelpMessage`
had simply drifted out of sync with already-implemented behavior (`/pause`/
`/resume` were dispatchable but undocumented; `/stop`/`/start` were
`HARD_VERBS` but missing from the help text's hard-confirm line). The hotfix
only corrected the help text to match shipped behavior — no new capability,
no unreviewed surface. **Confirmed intended, no follow-up ticket.**

**Idle liveness line drops `· N waiting`.** A deliberate, already-tested UX
change (`extension/test/telegramCursorBridgeLiveness.test.js` pins
`formatCursorBridgeLivenessLine(false, 2) === 'Bridge: idle'`), directly
coupled to this ticket's own subject: once the selection poll is the
actionable surface for a waiting queue, a second "N waiting" banner on the
idle line is redundant. No invariant references this line's content, and
reverting it would remove signal that is now carried by the poll itself, not
by two separate ambient counters. **Confirmed intended, no follow-up ticket.**

Both dispositions recorded here per "An Approval Authorizes Only Its Ticket's
Work" (BL-506): examined, not landed unexamined.

## required_wiring (all six satisfied)

- `specs/pipeline/steps/index.js::bl810HostQueuePollClearAllTtlSteps` —
  registered.
- `telegramCursorBridgeLive.ts::sweepExpiredQueuedPrompts` — still called
  from `processInboundUpdates`'s tail, unchanged call site.
- `telegramCursorBridgeLive.ts::clearAllOptionIndex` — still a real poll
  option (`postQueueSelectionPoll`); dequeues via the `decideQueuedPollAnswerAction`
  `clear-all` branch without starting a run.
- `telegramCursorBridgeCore.ts::clearAllOptionIndex` — still parsed/persisted
  (`parseQueuedPromptPoll`); D1's guard has a real field to evaluate.
- `telegramCursorBridgeCore.ts::originTopicId` — still parsed/persisted
  (`parseQueuedPrompt`).
- `telegramCursorBridgeLive.ts::poll_answer` — still the dispatch key in
  `processInboundUpdates`; acceptance scenario 10 proves the vote still
  arrives over the front desk's real fan-out (below).

## Acceptance (BL-112)

New step handlers:
`specs/pipeline/steps/bl810HostQueuePollClearAllTtlSteps.js` (registered in
`specs/pipeline/steps/index.js`), driving the REAL compiled
`telegramCursorBridgeLive.runCursorBridgePollOnce` (the poll-loop tick, the
TTL sweep, and poll-answer handling) plus, for scenario 10, the REAL front
desk (`telegramFrontDeskBotCore.pollAndForward`) writing through the REAL
file-based `cursorBridgeInboundQueue` that the bridge then drains — never a
reimplementation of the fan-out, the exact shape BL-810's own feature-file
header requires ("this slice must keep riding it, never add a second
transport").

```
$ bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-810-host-queue-selection-poll-clear-all-and-ttl.feature
...
# tests 12
# pass 12
# fail 0
```

(12 = 10 scenarios, with the two Scenario Outlines each expanding to 2 rows.)

## Unit / regression runs

```
$ npx vitest run test/telegramCursorBridgeLive.test.js test/telegramCursorBridgeCore.test.js
 ✓ test/telegramCursorBridgeCore.test.js (120 tests)
 ✓ test/telegramCursorBridgeLive.test.js (109 tests)
 Tests  229 passed (229)

$ npx vitest run test/telegramFrontDeskBotCore.test.js test/cursorBridgeInboundQueue.test.js test/telegramCursorBridgeLiveness.test.js
 ✓ test/cursorBridgeInboundQueue.test.js (4 tests)
 ✓ test/telegramCursorBridgeLiveness.test.js (14 tests)
 ✓ test/telegramFrontDeskBotCore.test.js (361 tests)
 Tests  379 passed (379)
```

`npm test` (full suite via `scripts/recordTestDuration.js`) run in full:
397 of 401 files / 7085 of 7092 tests passed. The 7 failures (4 files:
`dependencyGateCliReportsAndScope`, `dependencyGateCliStorageGlobals`,
`readLiveRoleHeldTicketsCli`, `renderBriefingDiagramsCli`) are confirmed
**pre-existing and unrelated**: none imports anything this ticket touches
(`grep -l` for `telegramCursorBridge|cursorBridgeInboundQueue|
telegramFrontDeskBotCore` across all four returns no match), and the machine
was under severe load throughout this run (`uptime`: load averages
150-209 on a 4-core host — the same class of condition as this project's
own "Stryker dry-run times out even at concurrency=1 under severe load"
lesson). Reproduced identically with every BL-811 change `git stash`-ed out
(pristine tree, same failures, same values) — `readLiveRoleHeldTicketsCli`
degrades to `{}` via its own documented fallback when the real `bb`
subprocess it shells out to fails/times out under load; the
`renderBriefingDiagramsCli` and `dependencyGateCli*` failures are subprocess
timeouts against a 20s test timeout. Not fixed here (out of this ticket's
scope, and not reproducible as a real defect — only as a load artifact).

## BL-654 declared-invariant coverage

Ticket declares three invariants.

1. **"No queued Host question can wait indefinitely behind stale queue
   state, stale poll state, or expired items."** — property test authored:
   `extension/test/bl811HostQueueInvariants.property.test.js`
   (`clearQueuedPollIfStale never leaves a poll in place unless it exactly
   reflects the current queue head...`). `postQueueSelectionPoll` refuses to
   post a fresh poll ONLY while `holder.state.pendingPromptPoll` is still
   truthy after `clearQueuedPollIfStale` runs — so this invariant reduces
   exactly to that one pure function never leaving a stale poll in place.
   Generator reach: an explicit 8-strategy enum (exact match,
   legacy-no-clearAll match, reordered, subset, foreign id, wrong
   clear-all index, emptied queue, no poll at all) forces every interesting
   poll/queue relation to appear every run, plus an assertion that all 8
   were actually reached in the 500-run budget — never left to chance.
   500 runs, `numRuns: 500`, clean. Non-vacuity: patched
   `clearQueuedPollIfStale` to unconditionally return its input unchanged —
   property failed immediately (`strategy: stale-clearall` counterexample);
   restored and re-verified clean.

2. **"Queue departures remain explicit and auditable: run-by-selection,
   clear-all, or TTL drop receipt."** — property test authored, same file:
   `decideQueuedPollAnswerAction only ever returns clear-all when
   clearAllOptionIndex is a real number match (BL-811 D1)...`, 1000 runs
   over the full `(itemIds, clearAllOptionIndex, selectedIndex)` space
   including all three "missing" shapes (`itemIds` empty,
   `clearAllOptionIndex` absent, `selectedIndex` absent) intermixed with
   valid ranges — this is D1 itself, generalized past the one legacy-poll
   example the unit test pins. A second, directly-named example test pins
   D1's exact regression shape. Non-vacuity: reintroduced the pre-fix
   comparison (dropped the `typeof` guard) in
   `telegramCursorBridgeCore.ts` — both property and pinned-example tests
   failed with the exact `clearAllOptionIndex: undefined` counterexample;
   restored and re-verified clean.

3. **"The poll-answer path remains live over the existing front-desk
   fan-out; no dark producer/consumer pair is introduced."** — **stated
   reason, no property test.** `attemptCursorBridgePollAnswerForward`
   (`telegramFrontDeskBotCore.ts`) is an unconditional 3-line forwarder with
   no branching on `poll_answer` CONTENT — only on the truthiness of
   `update.poll_answer` and the adapter's presence. A generative property
   varying `poll_id`/`option_ids`/`user` would be tautological: the function
   never inspects those fields. The invariant's real content is a WIRING
   claim (front desk appends to the same file the bridge drains, both
   through the same `opDir`) — inherently an integration property, not a
   pure data transform. Encoded instead by acceptance scenario 10
   ("the vote reaches the bridge over the front desk's existing fan-out"),
   which drives the REAL `pollAndForward` writing through the REAL
   `appendCursorBridgeInboundUpdate`/`drainCursorBridgeInboundUpdates` file
   queue into a REAL `runCursorBridgePollOnce({ useInboundQueue: true })`
   call, and asserts the vote was actually acted on (the item dequeued, the
   agent prompted) — proving liveness end to end, not by construction.

## e2e QA procedure

The ticket's own `notes` E2E procedure (items 1-4: D1 retraction survival,
real-flow starvation removal, TTL receipt topic routing, fan-out) all
require a live Telegram bot and a live Cursor agent session — this project's
Testability Boundary (webview/VS Code API surface, live tmux/PTY) doesn't
directly exclude Telegram/Cursor-SDK network I/O, but the coder role has no
live bot token or Cursor session in this environment. Every one of the four
procedure items is covered here at the unit/property/acceptance layer
(D1: property + manual probe; starvation: acceptance scenarios 01-03 + 09;
TTL receipt: acceptance scenarios 07-08 + unit test; fan-out: acceptance
scenario 10). QA owns re-running the human's manual E2E procedure against
the real deploy per the ticket's own instructions.
