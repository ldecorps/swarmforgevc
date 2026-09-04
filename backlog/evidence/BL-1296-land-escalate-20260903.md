# BL-1296 — QA verification PASSED, landing LAND_ESCALATE, 2026-09-03

## QA verification (own domain) — PASS

Received documenter's forward-pipeline commit `601c883a0b` (task
`BL-1296-bubble-answers-from-its-own-seat`), merged into this worktree
(`979fe02c72`). Ran the full Verification Order:

- `npm run compile` — clean.
- Unit suite (`vitest run`): 25 failures across 15 files, **byte-identical**
  to the pre-existing standing-debt set (already tracked: BL-1212, BL-1221,
  BL-1229, BL-1263, BL-1265, BL-1289, BL-1290, BL-1291). No regression from
  this merge.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1296-bubble-answers-from-its-own-seat.feature` — 6/6
  scenarios pass.
- `vitest run --config vitest.properties.config.mjs bl1296BubbleSeatInvariants`
  — 5/5 pass.
- `required_wiring` (`specs/pipeline/steps/index.js::bl1296BubbleSeatSteps`)
  confirmed live: `require('./bl1296BubbleSeatSteps')` present and the five
  scenarios actually execute via the acceptance run above.
- Read the invariant-critical source directly rather than trusting the
  docs' claim: `runBubbleSeatTurn` (`bubbleSeatLive.ts`) posts
  `answered.replyText` unedited from the SAME `processLetsTalkTurn` route
  the front desk itself uses — no code path composes an independent reply,
  so invariant 1 (never diverges) is structural, confirmed by reading, not
  assumed. `decideBubbleSeatTurn`'s first clause (`topicId !== seatTopicId`
  → not-mine) gates invariant 2 before anything is asked of the front desk;
  `cursorBusy` is accepted but never read, matching the ticket's own claim.
  `tryDispatchToBubbleSeat` is called inline within the bridge's existing
  poll (one `getUpdates` call site, line 2208 of
  `telegramCursorBridgeLive.ts`), confirming invariant 3 — no second poller
  opened.
- `human_approval`/`human_ruling` legitimacy: substantive, non-templated
  (the "strict echo" ruling plus detailed rationale distinguishing it from
  the two other options, referencing the coder's own finding about
  `withAgentLock` serialization) — genuine, not a repeat of the earlier
  false-report incident this same ticket's own `notes:` already documents
  and corrected in-ticket.
- `bounce_history`: one prior architect bounce (`500e6826c4`, blamed
  coder) — already reworked and cleanly re-passed through
  cleaner→architect→hardener→documenter (evidence files present for each
  stage); not still open.
- Diagram currency: documenter recorded an explicit NONE with reasoning
  (`BL-1296-documenter-20260903.md`) — no tracked diagram (architecture,
  swarm-flow, handoff-flow, front-desk-flow) change-triggers on
  cursor-bridge/seat-dispatch internals. Accepted as a reasoned judgment,
  not a skip.
- `qa_e2e` calls for a LIVE phone demonstration (send to Bubble topic while
  Cursor seat is mid-turn) that this environment cannot perform — no live
  bridge/phone access. Automated coverage above (acceptance + property +
  direct source read) is the full substitute available; noting the
  limitation explicitly rather than claiming a live demonstration occurred.

**Verdict: BL-1296's own implementation, tests, and ruling are all sound.
QA approves the work itself.**

## Landing — LAND_ESCALATE

`bb swarmforge/scripts/land_step_cli.bb BL-1296 979fe02c72` (from repo
root; took several minutes given the large ancestry this worktree now
carries) returned:

    LAND_ESCALATE
    BL-1296: entangled tip - sibling ticket(s) BL-1309,BL-1317,BL-1328,
    BL-1337,BL-1342,BL-1344,BL-1345,BL-1346,BL-1351,BL-1354,BL-1356,
    BL-1359,BL-1367,BL-1371,BL-1374,BL-1375,BL-1379,BL-848 unlanded as
    ancestors, tip-pure replay could not complete cleanly.
    land-step replay: refusing to publish BL-1296 - the replayed tree is
    not self-consistent with passenger sibling(s) BL-1309,BL-1328,BL-1337,
    BL-1346,BL-1351,BL-1354,BL-1356,BL-1359,BL-1375 riding on a shared
    path (BL-1375 invariant 2 / BL-1324):
    check_feature_handler_registration.sh refused the replayed tree:
      - missing registry module: bl1309LandDecideStepEntanglementSteps.js
      - missing registry module: bl1356StampOffWatchesTheRunSteps.js
      - missing registry module: bl1359MergeChargedOnlyWithIntroducedSteps.js

## Root cause

`specs/pipeline/steps/index.js` is a shared file. This worktree's tree
currently carries `require(...)` lines for BL-1309, BL-1356, and BL-1359
(their own forward-pipeline work landed in THIS worktree's history through
cleaner→architect→hardener, same as BL-1296) alongside BL-1296's own line
— but none of those three tickets' step-handler `.js` files are on
`origin/main` yet:

    git show origin/main:specs/pipeline/steps/bl1309LandDecideStepEntanglementSteps.js  → ABSENT
    git show origin/main:specs/pipeline/steps/bl1356StampOffWatchesTheRunSteps.js       → ABSENT
    git show origin/main:specs/pipeline/steps/bl1359MergeChargedOnlyWithIntroducedSteps.js → ABSENT
    git show origin/main:specs/pipeline/steps/index.js  → no bl1309/1356/1359/1296 requires at all

Per BL-1332, a shared path is replayed WHOLE, so BL-1296's tip-pure build
cannot silently drop those three siblings' require lines from `index.js`
while excluding their (not-BL-1296's-own) handler files — the resulting
tree would have dangling requires, which is exactly the class BL-1375's own
invariant 2 / BL-1324 registration guard exists to refuse. The guard is
working as designed; this is not a defect in it or in BL-1296.

This is the general shared-registry coupling already ticketed as **BL-1371**
("936 step handlers register by appending to one hand-maintained array...
three distinct incident classes so far, none of them a bug in the gates",
`status: todo`, still paused) — not re-minted here.

## Precondition check (BL-1241 remedy step 1) — does not apply

Not every entangled sibling is landable right now: BL-1309, BL-1356, and
BL-1359 each need their own independent QA verification pass before they
can land (their own forward-pipeline work sits only in worktree history,
same shape as BL-1296 before this pass) — not a quick land-in-order fix
available to me in this pass.

## Bounded rematch

`git fetch origin main` immediately before writing this: `origin/main` is
still `c04e752d55` — unchanged since the `land_step_cli.bb` attempt. Not a
timing race; the escalation is structural (the shared file's dangling
requires), not a stale-tip issue a rematch would resolve.

## Disposition

Not a bounce — nothing in BL-1296's own domain failed; code, tests, and
ruling are all verified above. **QA approval stands.** Per BL-1241 remedy
step 3, escalating to the specifier: naming the conflicting siblings
(BL-1309, BL-1356, BL-1359 specifically — their missing handler files are
the concrete blocker; the wider entangled-ancestor list is this worktree's
full unlanded history, not all individually blocking) and the shared path
(`specs/pipeline/steps/index.js`). A future land attempt on this branch
(or a future ticket) can retry once BL-1309/1356/1359 land their own
handler files, or once BL-1371 removes the shared-file coupling generally.

By QA.
