# BL-509 QA bounce evidence — 2026-07-17

## 1. Failing command
```
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-455-pipeline-board-epic-grouping-parked-slug.feature
```
Exit code: `1` (5 of 8 scenarios fail).

## 2. Commit hash tested
`c7f2eda0d4` — documenter's `git_handoff` for BL-509 slice 1 ("Document BL-509
slice 1: Amend button prompts and steers, plus restore BL-505 doc entry lost
in merge"), merged into `swarmforge-QA` as `b4e97ea3`.

## 3. First error excerpt
```
# Subtest: A ticket in a given state appears in exactly one place on the board [1]
not ok 2 - A ticket in a given state appears in exactly one place on the board [1]
  ---
  error: `Scenario "A ticket in a given state appears in exactly one place on the board" failed
  at step "Then ticket "BL-387" appears in the "stage grid"": Cannot read properties of
  undefined (reading 'length')`
  code: 'ERR_TEST_FAILURE'
  stack: |-
    runScenario (specs/pipeline/runtime.js:30:13)
# tests 8
# pass 3
# fail 5
```

## 4. Failure class
`acceptance` — this is the SAME crash (same root cause, same file, same line)
as the BL-505 bounce QA already filed earlier the same day
(`backlog/evidence/BL-505-pipeline-board-narrower-grid-and-lists-bounce-20260717.md`,
commit `06399b25`, since deleted by this very merge — see note below): a
stale `fixture.edited.length` reference inside
`specs/pipeline/steps/bl455PipelineBoardSteps.js`'s own `lastRendered`.

## 5. Expected vs observed
Expected: BL-455's own 8 acceptance scenarios green, per BL-509's own QA E2E
procedure step 4 ("Confirm the full acceptance + unit suite passes"), since
this parcel's history includes BL-510 ("fix-bl455-acceptance-step-handler-defects"),
whose commit `3db22bda` fixes exactly this crash (`lastRendered` no longer
reads `fixture.edited`).

Observed: the crash is back. `3db22bda`'s fix IS an ancestor of the tested
commit (`c7f2eda0d4`) and IS present on the cleaner's tip (`fcb3856f`), but is
ABSENT at the architect's merge immediately after
(`5a86b6e0`, "Merge commit 'fcb3856ff9' into swarmforge-architect", first
parent `90144497`) and every commit downstream of it (hardener `40da21ce`,
documenter `c7f2eda0d4`). The architect's branch had independently reverted a
duplicate BL-505 recovery merge earlier the same session
(`90144497`, "Revert Merge cleaner caedff8f4b (BL-505) for architecture
review") and that revert — or an adjacent conflict resolution in the same
sequence — silently dropped the `lastRendered` fix rather than just the
evidence-file/doc content it intended to revert.

This exact defect was independently caught and re-fixed downstream — commit
`f58dac59`, "Restore BL-510's fix, silently dropped by the BL-505
bounce-recovery merge" (2026-07-17 22:20:43), on `swarmforge-cleaner` /
`swarmforge-coder` — but that commit postdates and is NOT an ancestor of the
documenter's handoff (`c7f2eda0d4`, 22:20:22) that reached QA, so its fix
never made it into this parcel.

Separately, this parcel's Specification.MD hunk also tried to "restore" a
BL-505 doc paragraph describing the narrower-grid/2-word-slug/ID-column
behavior as shipped — but `extension/src/concierge/pipelineBoard.ts` on this
same commit does NOT contain that code (it was reverted from `swarmforge-QA`
in `6c3441cd` after QA's own earlier BL-505 bounce and never re-landed here).
Approving this doc text as-is would have documented functionality that does
not exist in the shipped code. QA resolved this locally while testing (kept
the BL-509 doc paragraph, dropped the premature BL-505 one, and dropped the
`bl505PipelineBoardNarrowerGridAndListsSteps` require in
`specs/pipeline/steps/index.js`, whose target file does not exist on this
branch) — but the underlying handoff should not have bundled BL-505/BL-510's
unresolved, previously-bounced state into a commit labeled only `BL-509`
without those tickets' own clean re-verification.

## Recommendation for re-submission
- Re-merge `f58dac59` (or re-apply its `lastRendered`/`splitBoardSections`/
  `idInParkedList` fix to `bl455PipelineBoardSteps.js`) through cleaner →
  architect → hardener → documenter, and confirm BL-455's acceptance suite is
  green *at the tip that reaches QA*, not just at an intermediate commit.
- Keep BL-509 slice 1's own scope (Amend prompt/steer/schema, which is
  correctly implemented, wired, and green in isolation — see notes below) separate from BL-505/BL-510's
  recovery; if they must ride the same branch, send them as distinguishable,
  individually-verifiable handoffs rather than folding BL-505's doc claim
  into BL-509's documenter commit.

## Note: BL-509 slice 1 itself
For the record, BL-509 slice 1's own contract verifies clean in isolation:
unit suite (324 files / 5405 tests) green, property suite (7 files / 20
tests) green, `specs/features/BL-509-amend-button-steers-ticket.feature`
(3/3) green, revised `BL-409`/`BL-410` features green, `tsc` compiles clean,
and `recordAmendReply` / `resetApprovalAskEmittedState` /
`queueAmendSteerDirective` are genuinely wired into
`recordAmendDecisionAndClose` (`telegramFrontDeskBotCore.ts`), called from
the real callback-handling path, not merely unit-tested in isolation. The
sole blocker is the reintroduced BL-455 acceptance crash and the premature
BL-505 doc restoration, both inherited from upstream merges outside BL-509
slice 1's own diff.
