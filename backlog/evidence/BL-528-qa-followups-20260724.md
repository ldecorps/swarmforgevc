# BL-528 — QA pass, two non-blocking follow-ups (2026-07-24)

## Verdict: PASS

Verified independently (compile, full unit suite 344 files/5789 tests,
property suite 32 tests, and the targeted swarm-script suite
`swarmforge/scripts/test/test_claim_progress_sweep.sh` including the new
test6/test6b covering the priority-bump requirement — sidecar cleared on
halt, relaunch does not re-halt on the first sweep). Ancestry check holds:
hardener tip `93f31c3c8` is an ancestor of the approved commit. Also
confirmed `heartbeat.ts`'s dead `isClaimWithoutProgress`/`isHeartbeatStale`/
`getHeartbeatTime` exports and the extension-side `claimHealer`/
`claimLiveness`/`claimTracker` duplicate are gone with zero remaining
callers (both architect SECONDARY findings from the send-back are
resolved).

Two items from the parcel's own trail are real but do not block this
ticket — flagging per "report it, don't fix it":

## 1. No `specs/features/BL-528-*.feature` exists

The ticket's own notes say "Specifier: write APS feature under
`specs/features/BL-528-*.feature` before coder work" and the `acceptance:`
field is still the placeholder ("# Specifier replaces this with
specs/features/BL-528-*.feature"). The architect flagged this as SECONDARY
in `backlog/evidence/BL-528-architect-bounce.md` and passed the parcel
forward anyway. No feature file exists post-merge either, so QA's own
acceptance gate (`run_acceptance.sh <feature-file>`) has nothing to run for
this ticket. The behavior itself IS covered at the swarm-script unit level
(`test_claim_progress_sweep.sh` test1-test8 exercise probe/nudge/bounce/
halt/relaunch end to end), so this is a spec-authoring gap, not a coverage
gap. Ask: specifier backfills the feature file (or files a ticket to do so)
so future BL-528-adjacent work has a real acceptance gate.

## 2. Pre-existing defect: stuck-escalation-email-sweep never fires

`swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh`
fails (times out waiting for `stuck-escalation-alarm coder delivered`).
Hardener isolated this as unrelated to BL-528 (`backlog/evidence/BL-528-
stuck-escalation-email-sweep-not-firing-20260724.md`: identical failure
with `handoffd.bb`/`chase_sweep_lib.bb`/the test file reset to `main`'s
copy). QA independently reproduced this a second way: same test, run in a
scratch `git worktree` checked out at `main` HEAD (`de76ddc36`, no BL-528
code at all) — identical FAIL. This is a real, safety-relevant gap (human
Telegram/email alert path for a stuck role) that predates BL-528 and is
not introduced by it. Ask: file a fix ticket to re-diagnose
`stuck-escalation-email-sweep!` / `decide-stuck-action` wiring on `main`.

By QA.
