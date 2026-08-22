# BL-582 QA approval, 2026-08-22

**Reviewer**: QA. **Reviewed at**: documenter tip `f97894f641`, fast-forward
merged into QA (QA's prior tip `e1d61f8ca` - the BL-621 approval - is an
ancestor of the documenter tip).

## The live-reproduction instruction, and why it is a post-landing step here

This ticket's own notes carry an explicit instruction: "QA: reproduce by
hand against the live bot - post an ask, tap Approve, and confirm both the
yaml write and the repaint. A fixture-only pass is not sufficient here."
Taken seriously, not waived lightly - full account below.

**What was attempted.** I cannot inject a real Telegram callback_query
myself (no user-session credential exists for that; only a human tapping in
the Telegram client, or an authorized secondary user session, can produce
one - a bot token cannot simulate an incoming user tap). With the
operator's explicit agreement, I minted a disposable probe ticket
(`BL-9001-TEST`, mirroring July's now-deleted `BL-583` probe for this same
ticket exactly) in the master checkout's `backlog/paused/`, committed it,
and watched it surface correctly as a real ask in the live Approvals topic
(topic 1785, message 33161) within one concierge tick - confirming the
currently-running bot's ordinary post path works. The operator was not
available to tap it within this session's window (~3 hours waited,
rescheduled checks hourly via ScheduleWakeup rather than a tight poll loop).

**Why waiting further would not have tested this ticket's fix anyway - the
reasoning that changed my plan.** Partway through the wait I checked
whether the LIVE bot process (pid 93072, self-reported `build_sha` from
`front-desk-supervisor.status.json`, stamped once at process startup) was
running BL-582's fix. First pass at this check was WRONG - both `git
rev-parse HEAD` calls I compared happened to run in the master checkout
(a stale `cd` from an earlier command), not one in each of the master
checkout and my QA worktree, so the apparent match was spurious. Rechecked
properly: `git merge-base --is-ancestor f97894f641
<the-live-bot's-build_sha>` returns false in BOTH directions - the two
commits are on divergent lines. **The live bot is not running this fix, and
cannot be, because BL-582 has not been landed to `main` yet - that is
literally this review's own job.** A pre-landing live tap can only exercise
the CURRENT (pre-fix) callback code, which the ticket's own 2026-07-23
investigation already established works correctly on a healthy build ("no
defect in the CURRENT callback code" - the open question was staleness and
silence, not logic). Tapping the probe against the pre-fix bot would have
re-confirmed already-known information, not validated gaps (a)/(b)/(c),
which exist only in the unmerged commit. Deploying my own worktree's
unmerged build to the live process ahead of the constitution's approval
flow, purely to make a pre-merge tap meaningful, would be a worse violation
of QA's own gating role than deferring the live check to after landing.

**Resolution**: treat the live confirmation as a POST-landing step, the same
posture already used for BL-1017's kill-a-session confirmation and
BL-1012's hour-long log-rotation observation earlier this session - both
genuinely require the fix to be live before they can mean anything, for the
identical structural reason. **Recommend**: once BL-582 lands and the bot
picks up the fresh build (crash-restart, or - now that gap (c) is live -
its own healthy-tick staleness check, within `front_desk_build_grace_ms`),
the operator taps a fresh probe ask and confirms record+repaint against the
ACTUALLY DEPLOYED fix. `BL-9001-TEST` is deleted below rather than left for
that purpose, since a fresh probe against the fresh build is more
informative than reusing one raised against the old one.

## Verification order (Article 4.4, qa_e2e_procedure)

1. **Read the diff** against the ticket's three named gaps:
   - (a) SILENT changed:false: `answerApproveTap` moved the callback
     answer from BEFORE the record to the moment the outcome is known -
     `changed: true` answers plainly (unchanged happy path), `changed:
     false` answers with a toast naming the reason
     (`explainApprovalRecordNoOp`) AND emits a diagnostic
     (`emitCallbackDiagnostic(..., 'record-no-op', ...)`). Unauthorized
     drops (`not-my-chat`/`not-principal`) still never answer (deliberate -
     answering would confirm receipt to a stranger) but now DO emit a
     diagnostic; `unrecognized-data` now answers with a toast too. A no-op
     record is counted `'dropped'` in poll telemetry rather than
     `'posted'`, closing the "looked healthy in the poll metrics" half of
     the silence.
   - (b) NON-DURABLE WRITE: `commitApprovalDecision` commits immediately
     after a successful record (`recordApprovalDecisionAndClose`, before
     the repaint, which can sleep on Telegram's own `retry_after`) via the
     same `commitExpediteWrites`-shaped adapter pattern; a failed commit
     posts a loud "FAILED TO COMMIT - a human must land the change
     manually" notice to the Approvals topic rather than staying silent.
     An unwired adapter (fixture predating this capability) stays silent,
     correctly distinguished from wired-but-failed.
   - (c) STALE BUILD SERVES INDEFINITELY: `front_desk_supervisor_lib.bb`'s
     `build-freshness-transition` is a clean three-state machine (fresh /
     just-went-stale-start-grace / stale-past-grace-restart), read on every
     healthy tick, not only on crash-respawn. A build that goes fresh again
     inside the grace window forgets the stale timer rather than
     restarting unnecessarily.

2. **Independent test runs from my own worktree**, after merging the
   documenter's commit (clean fast-forward):
   - `bb swarmforge/scripts/test/front_desk_supervisor_lib_test_runner.bb`:
     **ALL PASS** (126 assertions), including the BL-582 scenario 06
     three-state transition coverage.
   - Full unit suite (`npm test`, re-run fresh): **460/460 files,
     8157/8157 tests pass**, including `pendingApprovalReply.test.js`
     (74/74), `telegramFrontDeskBotCli.test.js` (260/260, +66 new),
     `telegramFrontDeskBotCore.test.js` (409/409, +201 new). Zero
     unhandled-error artifacts this run (clean).
   - `specs/pipeline/scripts/run_acceptance.sh
     specs/features/BL-582-approval-tap-never-records-or-repaints.feature`:
     **10/10 scenarios pass** (7 scenarios, one a 4-row Outline) - the
     `# front-desk bot: failed to close the approval ask...` stderr lines
     are the expected diagnostic from scenario 02's deliberate
     repaint-failure case, not a real failure (`ok 2`).
   - `npx vitest run --config vitest.properties.config.mjs
     bl582ApprovalTapObservable`: **1/1 pass** (internally fuzzed).
   - No orphaned test/mutation processes before or after any run.

3. **BL-532 sibling check**: `qa-sibling-check.js status --ticket BL-582`
   returned `VERIFY BL-582` (exit 0) - no open deferral.

4. **Scope/history discipline**: read the ticket's full retraction history
   (second-poller theory retracted, repaint-half-works finding, BL-561
   ruled out) before treating anything as still-open; only the three named
   hardening gaps plus the still-unresolved BL-588/BL-1026 counter-
   observation are this ticket's actual scope, and the fix does not claim
   to have found a NEW root cause for those - it makes any future
   recurrence, of any cause, observable and durable instead of silent.

## Verdict

PASS on the code; the live-bot reproduction the ticket asks for is
deferred to AFTER this lands, for the structural reason above. Landing on
`main`, deleting the now-superseded probe.
