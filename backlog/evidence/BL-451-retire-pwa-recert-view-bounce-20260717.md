# BL-451-retire-pwa-recert-view — QA bounce 2026-07-17

1. **Failing command**:
   `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-451-retire-pwa-recert-view.feature`

2. **Commit hash checked out and tested**: `79096f5d998b1c56df7df78eb24b3632640def1f`
   (QA's merge of documenter commit `04f6d0fae0`, task name
   `bl-339-retire-dead-steps`, backlog id BL-451).

3. **First error excerpt**:
   ```
   # Subtest: The redundant BL-339 recert deep-link notification is no longer sent
   not ok 2 - The redundant BL-339 recert deep-link notification is no longer sent
     ---
     duration_ms: 23.276357
     type: 'test'
     location: '.../specs/pipeline/generated/the-pwa-recert-view-and-the-redundant-bl-339-recert-notify-are-retired-once-recert-lives-in-telegram.generated.test.js:13:1'
     failureType: 'testCodeFailure'
     error: 'Scenario "The redundant BL-339 recert deep-link notification is no longer sent": no step handler matched "Given a recert batch is waiting on the human"'
   ```
   Result: `# tests 3 / # pass 2 / # fail 1`.

4. **Failure class**: `acceptance`.

5. **Expected vs observed**: Expected — scenario `retire-pwa-recert-02`
   passes end to end using the step handlers `bl451RetirePwaRecertViewSteps.js`
   registers. Observed — it fails at the `Given` step: `no step handler
   matched "Given a recert batch is waiting on the human"`.

## Root cause
`bl451RetirePwaRecertViewSteps.js`'s own header comment states: *"'Given a
recert batch is waiting on the human' is reused unscoped from
recertNotifySteps.js (BL-339) - pure git-backed fixture setup with no
dependency on the now-deleted notify CLI, so it is still safe to reuse."*
But this same parcel **deletes** `specs/pipeline/steps/recertNotifySteps.js`
(and drops its `require(...)` from `specs/pipeline/steps/index.js`) as part
of retiring BL-339's dead notify surfaces — so the step handler that defined
`Given a recert batch is waiting on the human` no longer exists anywhere.
The new file's own scenario 02 (`the recert notify sweep runs` / `no
recert-batch-waiting deep-link message is sent to Telegram`) is fully
implemented and correct; only the shared `Given` step it depends on was
removed out from under it in the same commit.

Confirmed by grep: `grep -rn "recert batch is waiting" specs/pipeline/steps/`
returns only the comment in `bl451RetirePwaRecertViewSteps.js` itself — no
registered handler.

## Other verification (all clean, not the cause of the bounce)
- Full extension unit suite: 315/315 files, 5074/5074 tests green.
- Property-test suite (`npm run test:properties`): 3/3 files, 9/9 tests green.
- `npm run compile`: clean.
- Acceptance scenarios 01 and 03 of this same feature: PASS.
- grep-verified no dangling references to the removed surfaces
  (`notify-recert-batch.ts`, `recertBatchNotifier.ts`,
  `generate-recert-batch.ts`, `notify/pwaDeepLinks.ts`,
  `render-recert-mailto.js`, `render-recert-listen.js`,
  `render-recert-backlog-context.js`, `recert-notify-sweep!` in
  `handoffd.bb`, `recert-batch.json`) other than a handful of stale
  code-comment mentions in unrelated files (`resume-expired-pauses.ts`,
  `claudeCliExecutor.ts`, `deadLetterNotifier.ts`, `notify-dead-letters.ts`,
  `notifyDeadLettersCli.test.js`) that reference the deleted file by name as
  a pattern example — not functional callers, not blocking this bounce, but
  worth a cleanup pass alongside the fix.
- `pwa/app.js` has zero remaining `recert` references; `pwa/locales.js`'s one
  remaining `recert` mention is a comment about the KEPT
  `recertification.ts` module, correct per the ticket's explicit keep-list.
- Kept modules intact: `recertification.ts`, `recertificationStore.ts`,
  `api/recert-webhook.js`, `recertInboundWebhook.ts`, `computeRecertBatch`.

## Fix needed
Add the missing `Given a recert batch is waiting on the human` step handler
to `bl451RetirePwaRecertViewSteps.js` itself (it is this feature's own
scenario now, not a borrowed one — the file it planned to borrow from is
gone), matching the same git-backed fixture setup `recertNotifySteps.js`
used to provide before deletion.
