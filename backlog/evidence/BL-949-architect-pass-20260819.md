# BL-949 architect pass — 2026-08-19

Reviewed commit: 896e1d5cb (via cleaner's merge 7185e6319a, unchanged —
`git diff 896e1d5cb 7185e6319a --stat` is empty).

## Scope
Test-only fix: `extension/test/conciergeTick.test.js` (2 tests
re-expressed), new `specs/pipeline/steps/bl949ConciergeBoardWiringSteps.js`,
and its registration in `specs/pipeline/steps/index.js`. No
`extension/src/` file touched, no `pipelineBoard.test.js` touched — matches
the ticket's `constraints:`.

## Dependency-rule gate (BL-259, hard gate)
`node extension/out/tools/dependency-gate.js` against the parcel's changed
files reports the same 3 pre-existing `telegram-front-desk-bot`/
`telegramCursorOperatorExec`/`telegramCursorOperatorLiveness` acyclic
violations seen on every recent pass (BL-947, BL-950) — none involve any
file this parcel touches. Confirmed ticketed: BL-759
(`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`).
Not a BL-949 defect.

## Co-change report (informational)
`conciergeTick.test.js` co-changes most with `conciergeTick.ts`,
`pipelineBoard.ts`/`.test.js` and sibling concierge-board suites — expected
coupling for a test file in this subsystem, nothing surprising. No new
coupling introduced by this parcel (it added no new source file).

## Invariants (both declared)
1. "A wiring test asserts only what the wiring proves": confirmed by
   inspection — neither corrected test asserts NBSP padding literally (only
   normalises it away), an exact caption string, or a fixed stage-row
   count/order. Header-id comparison sorts both sides before comparing, so
   column ordering isn't pinned either.
2. "Every corrected assertion stays non-vacuous": spot-checked
   independently rather than taken on the commit message alone — reverted
   `conciergeTick.ts`'s `readRoleHeldTickets` call to `roleHeldTickets = {}`
   (dropping the role-held join), recompiled, and confirmed the BL-455 test
   fails exactly as the commit message claims (`expected exactly one mark
   on the coder row` false). Restored and recompiled again; `git status`
   clean, full suite back to 111/111. The other two break points named in
   the commit message (active-membership join, epic/title meta join)
   weren't independently re-broken here — the mechanism is the same shape
   and the commit's own description of each is specific and consistent
   with the assertions actually written.

## Property testing
No pure module touched (constraints explicitly exclude `extension/src/`
changes) — no property-coverage action needed here.

## Unit/acceptance runs (reproduced live)
- `npx vitest run test/conciergeTick.test.js`: 111/111 passed.
- `./specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-949-concierge-board-wiring-asserts-the-live-layout.feature`:
  5/5 scenarios passed.
- `required_wiring` satisfied: `bl949ConciergeBoardWiringSteps.js` is
  registered in `specs/pipeline/steps/index.js`.

## Worktree note
This worktree's `backlog/paused/` copy of BL-949 was stale (the ticket had
already been promoted to `backlog/active/` on `main`) — merged `main`
(`9b2341697`) before finalizing this review, per the standing
worktree-staleness lesson from today's BL-935/BL-951 finding. No change to
the verdict below; `assigned_to: coder`, no `bounce_count` — first pass.

## Verdict
COMPLIANT. Forwarding to hardender.
