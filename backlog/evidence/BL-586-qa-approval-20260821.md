# BL-586 QA approval, 2026-08-21

**Reviewer**: QA. **Reviewed at**: documenter tip `f45be9d844`, fast-forward
merged into QA (QA's prior tip `2403b6031` is an ancestor of the documenter
tip, so no new merge commit was needed). Ancestry confirmed: coder fix
`c43202ca73` and hardener verification `c985a4f843` are both ancestors of
`f45be9d844` (`git merge-base --is-ancestor` for each).

## Verification order (Article 4.4, qa_e2e_procedure)

1. **Read the diff, not just the description.** `git show c43202ca73` on
   `extension/src/concierge/pipelineBoardSync.ts` confirms the described
   defect matches the actual pre-fix code: `resolveBoardTopicId`'s trust
   branch was `if (prevState?.topicId !== undefined) { return { topicId:
   prevState.topicId } }` - unconditional, no map lookup - exactly what the
   ticket's two incidents required. The fix replaces it with a call to the
   new `validateBoardTopic` against `telegram-topic-map.json` on every
   resolve, refuse-alert-re-ensure on a crossing.

2. **`required_wiring` verified live, by grep at the parcel commit** (not
   trusted from the hardener's note alone):
   - `PIPELINE_BOARD_SUBJECT_ID` exists in
     `extension/src/tools/telegramTopicDecisions.ts:218`.
   - `validateBoardTopic` is called from `resolveBoardTopicId`'s own trust
     branch (`pipelineBoardSync.ts:250`), not merely defined and tested in
     isolation - the exact BL-419 shape this wiring gate exists to catch.
   - `bl586PipelineBoardTopicIdentitySteps` is required from
     `specs/pipeline/steps/index.js:556`.
   - The call site (`telegram-front-desk-bot.ts:2907`) threads `targetPath`
     into `ensureBoardTopicAdapter`, and that adapter writes the standing
     record + topic-map binding (lines 1043-1056) *before* returning to the
     caller that posts - satisfies invariant 2's crash-window ordering.

3. **Independent full-suite runs from my own worktree**, after merging the
   documenter's commit (fast-forward, `git status` clean, no orphaned test
   processes before or after):
   - `npm test` (unit): **459/459 files, 8101/8101 tests pass.** The 459
     "Errors" in the summary are all the known-benign
     `[vitest-worker]: Timeout calling "onTaskUpdate"` artifact (grepped
     every occurrence - no other error text). The run's own suite-duration
     budget gate flags 21 pre-existing slow files - none of them BL-586's
     own test files - matching the coder's own note that this is
     pre-existing debt, not a regression from this ticket.
   - `npm run test:properties`: **130/130 files, 385/385 tests pass**,
     including `bl586PipelineBoardTopicIdentity.property.test.js` (2/2) -
     both declared invariants. 5 benign vitest-worker artifacts, nothing
     else.
   - `specs/pipeline/scripts/run_acceptance.sh
     specs/features/BL-586-pipeline-board-topic-identity-crossed.feature`:
     **6/6 scenarios pass** (Outline's 3 example rows + 3 singles), all
     handlers registered, no runtime THROW - satisfies qa_e2e_procedure
     step 6.
   - Unit and property/acceptance runs executed sequentially, never
     concurrently, per the Verification rule.

4. **qa_e2e_procedure steps 3/4 (durable-record mechanics, self-correction
   without stack-down)** are exactly what acceptance scenarios 02/03/04
   gate and what the property test's invariant-2 branch covers over random
   topic-map/standing-record combinations; both ran green above as an
   independent execution, not a re-read of the hardener's report.

5. **Documentation**: `docs/how-to/BL-586-pipeline-board-topic-identity-runbook.md`
   covers diagnosing a crossed identity post-fix, marks the 2026-07-23
   stack-down procedure legacy, and keeps the zombie-topic cleanup manual
   (Bot API cannot enumerate topics) - matches `out_of_scope`. `docs/index.md`
   links it.

6. **BL-532 sibling check**: `qa-sibling-check.js status --ticket BL-586`
   returned `VERIFY BL-586` (exit 0) - no open deferral to honor.

7. **No orphaned test/mutation processes** before or after this pass
   (`pgrep -fl 'node --test|stryker'` clean both times; QA never starts
   mutation itself).

## Verdict

PASS. Landing `f45be9d844` on `main`.
