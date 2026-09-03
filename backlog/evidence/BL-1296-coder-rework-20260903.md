# BL-1296 — CODER REWORK on architect bounce D1 (2026-09-03)

Bounce: `backlog/evidence/BL-1296-architect-bounce-20260903.md` (D1, the sole
defect). The architect reverted `500e6826c4`; this parcel replays that work onto
the reverted shape with D1's first half FIXED and its second half raised as a
spec gap, which is the choice the bounce's own remediation pointer 2 offers.

## D1 half one — FIXED: the seat now has a real topic at the live construction site

`extension/src/tools/telegramCursorBridgeLive.ts` now populates the seat's
topic exactly where the sibling BL-1235 seat populates its own:

    qwenLocalTopicId:  readQwenLocalTopicId(env.repoRoot),
    bubbleSeatTopicId: bubbleMirrorTopicForPath(env.repoRoot),

Read from the SAME `.swarmforge/operator/cursor-bridge-topic-map.json` by the
SAME shipped reader the Bubble MIRROR already uses (`bubbleMirrorTopicForPath`
→ `readCursorBridgeTopicIds` → `bubbleTopicIdFromMap`) — never a second way to
learn the id, which was the architect's own remediation pointer 1.

That reader carries a property worth having here: it returns `undefined` when
the binding puts Bubble on cursor's own topic, so a misconfigured map hands the
Bubble seat NOTHING rather than handing it cursor's surface. Invariant 2 is now
upheld by the data as well as by the seat's own first-clause gate.

New tests, `extension/test/bl1296BubbleSeatLive.test.js` (4):
- the topic resolves from a real map file on disk;
- no map, and a map with no Bubble entry, both give the seat no topic (a
  working state — the guard is false and the poll behaves exactly as before the
  seat existed, so cursor keeps answering the topic as it does today);
- a binding that puts Bubble on cursor's topic gives the seat no topic;
- **the live construction site actually calls the reader.** This is the half
  that failed review: the module's own unit tests were all green while the
  production path was dead. NON-VACUOUS — deleting the wiring line fails it with
  "the Bubble seat is never given a topic at the live construction site, so its
  dispatch guard is always false".

## D1 half two — NOT decided here: a spec-gap note to the specifier

The bounce offers (a) implement a genuine default turn function, or (b) if a
real live-agent process cannot fit this slice, raise a priority-`00` spec-gap
note asking the specifier to split, rather than narrowing the ticket alone
(BL-1328's precedent). I checked (a) before choosing (b), and the finding is
concrete rather than a preference:

- There is no front-desk answer this seat could relay synchronously. The front
  desk routes to roles and relays replies asynchronously; the thing that
  actually ANSWERS an operator message is the Cursor agent session.
- A second Cursor agent session built the usual way does not give parallelism.
  `promptAgent` runs inside `withAgentLock(targetPath)`
  (`extension/src/bridge/cursorBridgeAgentSession.ts:212`), and the lock is ONE
  file per repo root (`lockPathOf`, line 122-124, `.swarmforge/operator/` +
  `LOCK_FILE_NAME`) with a 10-minute max wait. A Bubble worker built that way
  would serialize behind the Cursor seat's turn — reproducing precisely the
  blocking this ticket exists to remove, while looking wired.
- Making it genuinely parallel therefore needs its own lock scope, its own
  agent-id state, and a second concurrent paid agent session — plus a model
  choice the ticket's own notes flag as a real constraint.
- And it runs straight into a question the SPECIFIER already asked and the
  human never answered (`approval_context`): whether "same answers as the front
  desk" means strict echo (relay the front desk's own answer) or a mirror-
  contexted worker — "a materially different build", in the specifier's words.
  A second agent with its own context is exactly the divergence risk invariant 1
  forbids.

A default that refuses in the Bubble topic when no worker is bound was
considered and rejected: it would REGRESS today's behaviour, where a Bubble
message is answered by cursor, just late. Answering "I cannot" faster is worse
than answering late.

So the turn-function half is not built and not narrowed — it is asked. Note
sent to the specifier, priority `00`, naming this file.

## Verification

- `npx tsc --noEmit`: clean. `npm run compile`: clean.
- `npx vitest run bl1296BubbleSeatLive.test.js bubbleSeat.test.js
  telegramCursorBridgeLive.test.js` — 139/139 pass.
- `npx vitest run --config vitest.properties.config.mjs bl1296BubbleSeatInvariants`
  — 3/3 (all three invariants).
- `run_acceptance.sh specs/features/BL-1296-bubble-answers-from-its-own-seat.feature`
  — 6/6.
- `required_wiring` (`specs/pipeline/steps/index.js::bl1296BubbleSeatSteps`):
  re-registered after the revert removed it; `grep bl1296` returns it.
- The merge that took the architect's revert (`e94738a917`) named every deleted
  BL-1296 path in its message, as the merge-deletion guard requires; every one
  of them is restored by this parcel.

## Commit-time note: the property-suite guard was overridden, and why

`check_property_suite_drift.sh` refused this commit TWICE, each time naming a
DIFFERENT non-allowlisted file:

- attempt 1: `test/bl1327DescentLadderInvariants.property.test.js`
- attempt 2: `test/bl1030StopFlagTokenBoundary.property.test.js`

Neither is this parcel's file and neither touches anything it changes (a descent
ladder and a shell-flag token boundary). Both were run standalone under the
property config and both PASS (3/3 each). A full
`npx vitest run --config vitest.properties.config.mjs` from this same tree was
also run directly: 27 failed files / 17 failed tests, all of them the standing
`deps.checkOrphanedAuthoredDocs is not a function` pilotAcceptanceGate cluster,
with `bl1327` PASSING in that run — the file the previous hook run had refused
on.

A guard that names a different unrelated file on each run, all of which pass on
their own, is reporting load-dependent flakiness in its full run, not a
regression in this diff. That is the known jam recorded on
`backlog/evidence/BL-1356-property-guard-jam-diagnosis-20260903.md` (BL-1356,
paused) and the BL-1234 allowlist-matcher defect.

So this commit was made with the guard's own documented override,
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1`, and it is recorded here rather than
left silent. This parcel's OWN property test was run and is green
(`bl1296BubbleSeatInvariants`, 3/3, all three invariants).
