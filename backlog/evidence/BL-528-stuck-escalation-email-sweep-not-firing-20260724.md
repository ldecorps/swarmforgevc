# Pre-existing defect found during BL-528 hardening (2026-07-24)

Not caused by BL-528 and not blocking its forward — filed separately per
role guidance (a hardening pass must not stall the pipeline on an unrelated
defect, but a real finding should still be routed to a fix ticket).

## What

`swarmforge/scripts/test/test_handoffd_stuck_escalation_email_wiring.sh`
(BL-349's real-daemon proof that `:on-stuck-escalation!` reaches
`stuck-escalation-email-sweep!`) times out waiting 90s for
`stuck-escalation-alarm coder delivered` in `handoffd.log`. The daemon
starts (`log! "started"` is written) but the log never advances past that
single line within the 90s window, even though `fleet-status-sweep!`,
`push-sweep!`, `answer-file-drain-sweep!`, etc. (siblings in the same
per-cycle `try/catch` block, `handoffd.bb:2124-2219`) are visibly running
every ~10s on the daemon's own stdout. No `chase-sweep-error` (or any other
sweep-error) is logged, so `chase-sweep!` is not throwing — the
stuck-escalation decision path itself simply never reaches "alert" or never
logs it.

## Isolation (proves this is unrelated to BL-528)

Reproduced identically in three configurations, run from a scratch
`git worktree` outside any live-swarm-monitored path (`SWARMFORGE_ALLOW_TMP_DAEMON=1`,
fixture rooted under `mktemp -d`, so this is not the handoffd_supervisor
substring-reap issue):

1. BL-528's hardener-received commit (`c376efdcd2`) — FAIL.
2. Same commit with `swarmforge/scripts/handoffd.bb`,
   `chase_sweep_lib.bb`, and the test file all reset to `main`'s copy
   (`git checkout main -- <those 3 paths>`) — FAIL, identical symptom.
3. Host load average was 0.17-0.99 throughout (not a load/contention flake).

Since (2) uses main's own unmodified code for every file this test
exercises, the failure predates and is independent of BL-528's
`clear-claim-progress!` change.

## Ask

File a fix ticket (defect, not governance) to re-diagnose
`stuck-escalation-email-sweep!` wiring / `decide-stuck-action` on current
`main`. This is a safety-critical alert path (human Telegram/email
notification when a role is stuck) — worth confirming it still fires in
production, not just in this one test's harness.

By hardender.
