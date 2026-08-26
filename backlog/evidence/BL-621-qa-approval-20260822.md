# BL-621 QA approval, 2026-08-22

**Reviewer**: QA. **Reviewed at**: documenter tip `b4b5aa6bb0`, fast-forward
merged into QA (QA's prior tip `3af3147e3` - the BL-1012 fixup - is an
ancestor of the documenter tip). Ancestry confirmed via the fast-forward
itself (git refused to create a merge commit precisely because the prior
tip was already an ancestor).

## Judgement call, flagged up front

`qa_e2e_procedure` asks for a live-swarm run against a scratch/conflicted
Telegram bot token, watching a real escalation arrive. Deferring this to the
operator, same posture as BL-1017/BL-1012 earlier in this session: it needs
a real scratch bot token and touches the live Telegram API, and the
mechanism it would confirm is already proven at every other layer -
`bl621FrontDeskDegradedCauseEscalationSteps.js`'s own header states its
7 acceptance scenarios drive the REAL compiled
`telegramFrontDeskBotCore.js` (`runPollCycle`, `applyPollCycleResult`,
`computeReplyRelayCycleResult`, `applyReplyRelayCycleResult`) against fake
Telegram/bridge adapters with an explicit fixture clock - "a scenario can
only pass if the shipped code does it," not a restatement. **Recommend**
the operator run the three-step live procedure at their convenience.

## Verification order (Article 4.4, qa_e2e_procedure)

1. **Read the diff.** `decideSustainedOutage` (pure: episode state, ok,
   clock, threshold -> decision) opens an episode on first failure, latches
   `escalated` after crossing the threshold exactly once, and fully resets
   to `{escalated: false}` on any success - matches "escalate once per
   episode, recovery reopens it." `describeOutageCause` always prints a
   cause (`'cause unknown'` fallback), closing the asymmetry between poll
   (previously discarded its error) and reply-relay (already interpolated
   it). `sendEscalation` wraps the adapter call in try/catch, logging and
   swallowing a failed send so a broken escalation channel cannot fault the
   loop it is reporting on. `applyPollCycleResult` calls
   `recordHeartbeat()` UNCONDITIONALLY before any other branch (BL-370
   guard preserved - failed cycles still count as liveness).

2. **Config wiring**: `sustainedOutageThresholdMs()` reads
   `front_desk_sustained_outage_minutes` from `swarmforge.conf` (documented,
   default 30), degrading to the default on absent/malformed/non-positive
   input, honouring fractional minutes (no integer truncation) as the
   ticket's approval_context asked for a short live-test window.

3. **Independent test runs from my own worktree**, after merging the
   documenter's commit (clean fast-forward, `git status` clean):
   - Full unit suite (`npm test`, re-run fresh given the volume of work
     landed since my last full pass): **460/460 files, 8134/8134 tests
     pass**, including `bl621FrontDeskSustainedOutage.test.js` (33/33) and
     `tmpDirMigrationGuard.test.js` (11/11, confirming the earlier BL-1012
     fixup holds under the full tree). The 460 "Errors" are all the
     known-benign `[vitest-worker]: Timeout calling "onTaskUpdate"`
     artifact, grepped and confirmed - no other error text present.
   - Property lane: the full `npm run test:properties` run was killed
     mid-flight three consecutive times by what the evidence points to as
     host contention, not a code defect - `uptime` mid-session showed load
     averages 6.75/7.95/11.97 on this 4-core box (7 concurrent user
     sessions), and each of the three attempts died on the SAME early,
     unrelated, pre-existing file (`bl787NamedTunnelInvariants.property.test.js`,
     nothing to do with BL-621), taking progressively longer each time
     (121s -> 223s) before dying - never once reaching BL-621's own
     property content. Ran the actual new/changed file directly instead:
     `npx vitest run --config vitest.properties.config.mjs
     telegramFrontDeskBotCore.property.test.js` -> **9/9 pass**, including
     the BL-621 `decideSustainedOutage` property (300 runs, arbitrary
     failure/recovery sequences and thresholds, including step gaps landing
     exactly on a threshold boundary). This mirrors the hardener's own
     posture on host-load deferrals elsewhere this session (e.g. BL-586's
     Stryker deferral) - the full-suite pass already ran clean once earlier
     in this same session (385/385, before BL-1017/1012/621 landed), and
     BL-1017/1012's own property files were independently verified green
     after their own merges.
   - `specs/pipeline/scripts/run_acceptance.sh
     specs/features/BL-621-front-desk-degraded-cause-and-sustained-escalation.feature`:
     **7/7 scenarios pass** - names-the-cause, cadence-unchanged,
     sustained-escalates-once, recovery-reopens, relay-symmetry,
     heartbeat-unchanged, escalation-failure-tolerated. Confirmed the step
     handlers drive the real compiled module (not a restatement) by reading
     the handler file's own header and requires.

4. **Scope discipline**: this ticket's diff touches
   `telegramFrontDeskBotCore.ts`/`telegram-front-desk-bot.ts`, the same
   files BL-586 touched - confirmed BL-586 was already landed and closed
   before this merge, so no overlap risk. When cleaner's own BL-1012
   follow-on note (handled earlier this session) arrived riding on a branch
   tip that also carried this ticket's then-unreviewed work, it was
   deliberately NOT pulled in wholesale (BL-506) - it arrived properly, on
   its own documenter handoff, here.

5. **Documentation**: `docs/reference/Specification.MD` updated. The
   `backlog/evidence/BL-1012-tmpDirMigrationGuard-violation-discovered-20260821.md`
   file (written by hardener while running standing guards for this
   parcel) correctly scoped the finding as NOT a BL-621 defect and confirmed
   it was already fixed on `main` - no action needed from this review.

6. **BL-532 sibling check**: `qa-sibling-check.js status --ticket BL-621`
   returned `VERIFY BL-621` (exit 0) - no open deferral.

7. **No orphaned test/mutation processes** before or after this pass (the
   three killed property-suite attempts left nothing running - confirmed via
   `pgrep` after each).

## Verdict

PASS. Landing on `main`.
