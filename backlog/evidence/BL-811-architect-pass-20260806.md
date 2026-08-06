# BL-811 — architect pass

Reviewed commit: `a84ea970fb1bb73a30eb465de8c0b92c27f88f1e` (received from
cleaner unchanged — coder's own commit, cleaner found nothing to clean).
Parcel diff scope: `90a4608f..a84ea970fb`, 6 files (2 source, 1 property
test, 2 acceptance step-handler files, 1 evidence file).

Result: **NONE — no defects found. Architecturally compliant.**

## Dependency-rule gate (REQUIRED HARD GATE, BL-259)

`node out/tools/dependency-gate.js src/tools/telegramCursorBridgeCore.ts
src/tools/telegramCursorBridgeLive.ts` and a full-repo scan both report the
same 3 `acyclic` violations
(`telegram-front-desk-bot.ts` / `telegramCursorOperatorExec.ts` /
`telegramCursorOperatorLiveness.ts`). Confirmed **pre-existing and unrelated**
to this parcel:
- Neither BL-811-touched file appears in any reported edge.
- `git diff --stat 90a4608f a84ea970fb -- <each of the 3 implicated files>`
  is empty — byte-identical across this parcel.
- Already tracked: `backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`.

Not a BL-811 send-back item.

## Co-change coupling (BL-255, informational)

`co-change-report.js` on the two changed source files reports only the
expected Core/Live/test coupling for this subsystem (12/11/9 co-changes with
their own test files and each other) — no surprising cross-module coupling.

## D1 — vote-retraction queue wipe (confirmed fixed, non-vacuity independently re-verified)

Read the diff directly: `decideQueuedPollAnswerAction`
(`telegramCursorBridgeCore.ts`) now requires
`typeof pendingPoll.clearAllOptionIndex === 'number'` before comparing to
`selectedIndex`, closing the `undefined === undefined` hole. `Live.ts`'s
`processQueuedPollAnswer` correctly switches on the three returned action
kinds (`select` / `clear-all` / `ignore`) with unchanged externally-visible
behavior for every non-D1 case.

Independently reintroduced D1 myself (dropped the `typeof` guard) and reran
`npm run test:properties -- test/bl811HostQueueInvariants.property.test.js`:
2 of 3 properties failed immediately with the exact counterexample shape
(`clearAllOptionIndex: undefined`, `selectedIndex: undefined`, resolving to
`clear-all` instead of `ignore`). Restored the fix; reran clean (3/3).
Non-vacuity is real, not asserted.

## D2 — help-text and liveness-line changes (confirmed correctly scoped)

Checked the original hotfix commit `2b8d19d1` directly:
`extension/src/tools/telegramCursorOperatorCore.ts` (owns `SOFT_VERBS` /
`HARD_VERBS` dispatch) is **not** in its file list — the hotfix only edited
the `formatHelpMessage` string in `telegramCursorBridgeCore.ts` to describe
already-dispatchable verbs, confirming the coder's claim of no new,
unreviewed command surface. Hotfix stat also confirms
`telegramCursorBridgeLiveness.ts` (4 lines) is the only liveness-line change,
matching the ticket's description. No follow-up ticket needed.

## Invariants review (BL-633/BL-654)

All three ticket-declared invariants carry either a property test or a
stated, verified non-encodability reason — no missing/vacuous obligation.

1. No-starvation — property test, verified non-vacuous above (shared file
   with D1/invariant 2).
2. Explicit/auditable departures — same property file, second property;
   this IS D1 generalized. Verified non-vacuous by the same reintroduction.
3. Fan-out liveness — no property test; read
   `attemptCursorBridgePollAnswerForward` directly
   (`telegramFrontDeskBotCore.ts:2220`): branches only on
   `update.poll_answer` truthiness and adapter presence, never on
   `poll_answer` content — a generative property here would be tautological,
   confirming the coder's stated reason. Encoded instead by acceptance
   scenario 10, independently run below.

## required_wiring (all six re-checked)

Read `bl810HostQueuePollClearAllTtlSteps.js` directly: imports
`runCursorBridgePollOnce`, `pollAndForward`, `appendCursorBridgeInboundUpdate`
from the compiled `out/` tree (real functions, not reimplemented) — matches
the required_wiring claim that the vote rides the real front-desk fan-out,
never a dark producer/consumer pair.

## Verification run myself (not just re-reading evidence)

- `npm run compile` — clean.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-810-host-queue-selection-poll-clear-all-and-ttl.feature`
  — 12/12 pass (including scenario 10, the fan-out scenario).
- `npx vitest run test/telegramCursorBridgeLive.test.js
  test/telegramCursorBridgeCore.test.js test/telegramFrontDeskBotCore.test.js
  test/cursorBridgeInboundQueue.test.js test/telegramCursorBridgeLiveness.test.js`
  — 608/608 pass.
- `npm run test:properties -- test/bl811HostQueueInvariants.property.test.js`
  — 3/3 pass, non-vacuity independently re-verified (see D1 above).

## Architecture checklist (this project's rules)

- Two-layer boundary (tiles/webview view vs. tmux substrate): not touched by
  this parcel (Telegram/Cursor bridge subsystem, no webview/tmux code).
- Extension-host I/O ownership / webview storage / secrets: not applicable —
  no webview or secret-handling code touched.
- Integrate-not-fork: not applicable — SwarmForge core untouched.
- Dependency direction: clean for this parcel's own edges (see gate above).

No correctness defects spotted beyond what the coder's own evidence already
covers. Forwarding to hardener.
