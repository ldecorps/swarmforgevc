# BL-767 — architect pass — 2026-08-13

## Scope reviewed

Parcel received from cleaner at `0c7dcd3556` (merged into architect on top
of `1539162ee`, merge-base `9b5e98c3b`). Commits in scope:

- `d5faf1e7d` (coder) — "BL-767: queued bridge questions answer in the
  topic they were asked in".
- `0c7dcd355` (cleaner) — "BL-767: DRY the paired liveness-cue sync calls"
  (jscpd-flagged duplicate 11-line block; added `syncBridgeLivenessCues` to
  run the pair at all three call sites; behavior-preserving per cleaner's
  own commit message, confirmed below).

Files touched: `extension/src/bridge/bridgeServer.ts`,
`extension/src/tools/telegramCursorBridgeCore.ts`,
`extension/src/tools/telegramCursorBridgeLive.ts`,
`extension/src/tools/telegramCursorBridgeLiveness.ts`,
`extension/test/{letsTalkBridge,telegramCursorBridgeLive,
telegramCursorBridgeLiveness}.test.js`,
`extension/test/{telegramCursorBridgeCore,telegramCursorBridgeLive}.property.test.js`,
`specs/pipeline/steps/bl767QueuedBridgeQuestionsAnswerInOriginTopicSteps.js`
(new) + `specs/pipeline/steps/index.js` (registration).

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js` against the four changed
source files: FAILED, but only on the pre-existing `telegram-front-desk-
bot.ts` → `telegramCursorOperatorExec.ts` → `telegramCursorOperatorLiveness.ts`
acyclic cycle (reached because `telegramCursorBridgeLive.ts` imports
`telegramCursorOperatorExec.ts`, pulling the reachable graph in). Reproduced
identically on `main` before this parcel (`node
extension/out/tools/dependency-gate.js src/tools/telegram-front-desk-
bot.ts src/tools/telegramCursorOperatorExec.ts
src/tools/telegramCursorOperatorLiveness.ts` run against both worktrees
gives the same 3 edges). None of the three cycle files are touched by this
parcel, and none of the cycle files import back from any BL-767 file (no
new edge closes a new loop). Already tracked as `BL-759` and confirmed
unrelated by nearly every prior architect pass this month (BL-826, BL-848,
BL-871, BL-877, GH-26, etc.) — same three edges verbatim each time. Not
attributable to this parcel.

## Co-change coupling (BL-255)

`node extension/out/tools/co-change-report.js` against the four changed
source files: `bridgeServer.ts` reports its usual large fan-out (own test
file, sibling bridge/UI files, the step registry) — expected for a
high-touch file, nothing new. Scoped individually,
`telegramCursorBridgeLiveness.ts` co-changes only with its own test file
and its two sibling bridge-tool files (`Core.ts`, `Live.ts`) — exactly the
files this ticket's own scope names. No suspected coupling outside the
parcel's declared scope.

## Required wiring (both items, literal grep)

1. `telegramCursorBridgeCore.ts::originTopicId` — present on both
   `CursorBridgeQueuedPrompt` (pre-existing, added under a prior human
   commit `2b8d19d178` 2026-08-05) and `CursorBridgeChoicePoll` (this
   parcel). Tolerant parsing added (`parseChoicePoll` only copies the field
   when `typeof value.originTopicId === 'number'`). "A field nothing
   writes routes nothing" is satisfied: the sole choice-poll creation site,
   `appendPendingChoicePoll` in `bridgeServer.ts`, now writes it (see Scope
   note below) — without that write this whole half of the fix would be
   dead.
2. `telegramCursorBridgeLive.ts::originTopicId` — every deferred-reply site
   now reads through the single shared `resolveDeferredReplyTopicId`
   (`originTopicId ?? cursorTopicId`) instead of an ad-hoc per-site
   fallback: `sweepExpiredQueuedPrompts`, `processQueuedPollAnswer`,
   `processChoicePollAnswer` (both the busy-requeue and idle-reply
   branches — the busy branch also now passes `poll.originTopicId` into
   `pushQueuedPrompt` instead of `undefined`, fixing the "answers Bubble
   when idle, Cursor Remote when busy" defect at its root).

## Correctness note: the fix targets the CURRENT live path, not a stale one

The ticket's Root Cause section (written against `main@8978215ac`) names
`runNextQueuedPrompt` as the defect site and calls `processQueuedPollAnswer`
/ `pendingPromptPoll` dead code with no producer. Neither is true of the
code the coder actually worked against: `runNextQueuedPrompt` no longer
exists: the queue-drain UX was restructured, by the time this ticket
reached coder, into `presentQueueSelectionPollAfterIdle` →
`postQueueSelectionPoll` (posts a real selection poll, and now *does*
write `pendingPromptPoll` at `Live.ts:1431`, confirmed by grep — a real
producer that didn't exist at the ticket's source commit) →
`processQueuedPollAnswer` (answers it). The coder's fix at that exact site
(`resolveDeferredReplyTopicId(selected.originTopicId, holder.state.cursorTopicId)`,
`Live.ts:1551`) is therefore not "fix for consistency on dead code" as the
ticket assumed — it is the live fix for the ticket's headline defect,
correctly located despite the ticket text being stale on this one point.
Verified by re-reading `main` at the ticket's cited commit vs. this
parcel's merge-base rather than taking either the ticket's or the coder's
characterization on faith.

## Scope note: `bridgeServer.ts` is not in the ticket's declared Scope bullets

The ticket's Scope section names three `extension/src/tools/` files plus
`specs/pipeline/steps/`; `extension/src/bridge/bridgeServer.ts` is not
listed. The parcel touches it anyway (`appendPendingChoicePoll` gains an
`originTopicId` parameter, and its one caller,
`mirrorLetsTalkChoicePollToBubble`, now passes the poll's own `topicId`).
Judged in-scope, not a BL-506 breach: `appendPendingChoicePoll` is the
*only* site in the repo that constructs a `CursorBridgeChoicePoll` record
(confirmed — `pendingChoicePolls`/`CursorBridgeChoicePoll` appear nowhere
else outside `Core.ts`'s parser and `Live.ts`'s reader), so required-wiring
item 1 ("a field nothing writes routes nothing") is unsatisfiable without
this exact one-parameter, one-call-site change. Minimal, directly
necessitated by the ticket's own wording, and covered by a new assertion in
`letsTalkBridge.test.js` (`state.pendingChoicePolls[0].originTopicId ===
91`).

## Invariants review (BL-633/BL-654)

Ticket declares two invariants. Both carry a property test — checked for
existence and non-vacuity before any hand-verification, per this role's
Invariants Review order.

1. *"A queued prompt is answered in exactly one topic..."* —
   `telegramCursorBridgeLive.property.test.js`, two properties: (A) the
   pure resolver `resolveDeferredReplyTopicId` never returns a third value
   outside {origin, cursorTopicId}; (B) an integration-level property that
   drives the **real** `runCursorBridgePollOnce` end to end across both
   real drain paths (`queued-prompt` selection-poll answer and
   `choice-poll` answer) × (origin recorded / absent), asserting the reply
   lands in exactly one topic matching the resolver's own expected value.
   Property B is exactly the sweep the ticket's own notes call for
   ("sweeps (origin topic recorded or absent) x (drain path)") and is the
   one BL-590-shaped check that would have caught a per-site fallback drift
   early rather than one site at a time. Non-vacuous by construction: it
   asserts equality against a computed expected value, not a boolean
   truthiness check.
2. *"A bridge state file written before this change still parses and still
   drains..."* — `telegramCursorBridgeCore.property.test.js`, two
   properties: one fuzzes `originTopicId` across valid/absent/malformed
   (string, boolean, null, array, object) shapes on both a queued-prompt
   and a choice-poll record and asserts `parseCursorBridgeState` never
   throws and never drops either record; the other pins the exact
   pre-BL-767 file shape (field absent everywhere) and asserts it parses
   identically to before. Non-vacuous: malformed-input arm would fail
   against a naive `value.originTopicId` cast with no `typeof` guard.

Both properties reviewed against the actual sites they claim to cover (not
just read in isolation) — confirmed accurate.

## Test results

System load was extreme during this pass (`uptime` load average ~118 on a
4-core box — other swarm activity, at least one other role's git-log-heavy
tooling and a concurrent property run for a different ticket, BL-760, were
running at the same time) and the full `npm run test:properties` /
recompile run stalled for 7+ minutes with no output; killed rather than
left to contend for CPU. Substituted a scoped, targeted run instead:

- `npx vitest run --config vitest.properties.config.mjs
  test/telegramCursorBridgeCore.property.test.js
  test/telegramCursorBridgeLive.property.test.js` — **2 files, 5 tests,
  all pass** (16.5s).
- `npx vitest run test/telegramCursorBridgeLive.test.js
  test/telegramCursorBridgeLiveness.test.js
  test/telegramCursorBridgeCore.test.js test/letsTalkBridge.test.js` —
  whole files, not just the new/touched tests (sibling-regression
  discipline) — **4 files, 299 tests, all pass** (18.2s).
- `npm run compile` (tsc) — clean, no errors; `out/**` timestamps confirm
  it reflects this merge's `src/`.

Full-repo property/unit suites were not re-run beyond the files this
parcel touches; that is hardener's mutation/coverage pass, not this one.

## Disposition

**CERTIFY.** No architecture violation, no invariant violation, no
correctness defect found. Forwarding to hardender.
