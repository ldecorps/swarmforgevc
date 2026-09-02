# Intake: operator hotfix landed - handoffd crash loop (vanished outbox parcel + supervisor startup grace)

Filed by the Operator (2026-09-02, human-directed via Claude Code). NOTICE plus
a BL-848 stamp-off request; the specifier drains this like any root item.

## What landed on main (live after a controlled daemon restart)

`27d6ab8630` - trailer `Hotfix-Certification: pending`, ledger row recorded.

1. `handoffd.bb` poll-once! read each listed outbox parcel OUTSIDE the try
   around deliver!; a parcel the sender archived between listing and read
   threw FileNotFoundException through poll-once! and killed the daemon
   (11:18, 12:14, 14:54, 15:25 today; same signature 2026-08-30; never
   ticketed). New `handoff_lib/read-envelope-if-present` answers
   `{:vanished true}` for gone/unreadable; poll-once! logs
   `outbox-parcel-unreadable` and skips that parcel this poll.
2. `handoffd_supervisor.bb` ran check! before its first sleep; after a crash
   the stale heartbeat + still-pending crashing parcel read :stalled 0.25s
   after start and halted the swarm again (15:28, 15:29), with the BL-675
   cron relaunching into the same verdict. evaluate-health gains
   `:daemon-age-ms` (pid-file age): a daemon younger than one stall window
   cannot be :stalled. Unknown age grants nothing; :dead untouched.

## Evidence (TDD, isolated worktree, RED then GREEN)

- handoff_lib_test_runner.bb ALL TESTS PASSED (+5; RED: unresolved symbol)
- test_handoffd_outbox_vanished_parcel_wiring.sh 4/4 (real daemon, mode-000
  parcel as the deterministic stand-in; RED: daemon died at step 01)
- handoffd_supervisor_startup_grace_test_runner.bb ALL TESTS PASS (7; RED:
  the two grace assertions :stalled, every safety assertion passing)
- bl977_supervisor_progress_property_runner.bb 200 draws ALL PROPERTIES HOLD
- test_handoffd_ambulance_wiring.sh 0 FAIL
- test_handoffd_supervisor.sh scenario 01 fails identically on unmodified
  main (tmux shim shadowing) - pre-existing, worth its own chore.

## Asks

1. Specifier: mint ONE BL-848 stamp-off for `27d6ab8630` and `--link` it.
   Grep the SHA across backlog/ first - do not double-mint.
2. Worker worktrees need no hand-port: both files run only from the master
   checkout; roles pick the change up on their normal merge of main.

By operator.
