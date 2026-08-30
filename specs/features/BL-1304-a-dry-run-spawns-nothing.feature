Feature: An expedite dry run plans and spawns nothing, whatever an earlier run left on disk

  `expedite.sh --dry-run` is documented as "plan and print; touch nothing".
  Every side-effecting step in expedite_cli.bb honours that flag - the
  teardown, the backlog adopt, the park, the ticket move, the progress
  writes, the QA-hat record and the restart are each gated on `dry-run?`.
  The stage driver is not. `-main` calls `drive-stages!` unconditionally, and
  `run-stage!` does not read the flag at all, so a dry run walks into the
  real stage launcher and tries to start role agents.

  Today that fails by luck rather than by design. `ensure-worktree!` also
  honours the flag, so a dry run never creates the worktree it then asks the
  launcher to run inside, and the launch dies on a missing working directory.
  The luck runs out the moment a worktree for that ticket already exists -
  which is exactly the state a re-run lands in, because `ensure-worktree!`
  short-circuits on an existing directory and an earlier real run leaves one
  behind. Then the dry run has a valid directory, reaches the launcher, and
  executes the whole expedited run for real.

  Observed 2026-08-30: a coordinator's `expedite.sh BL-1288 --dry-run` exited
  1 inside bounded_run_lib with `Cannot run program "setsid" (in directory
  ".worktrees/expedite-BL-1288")`. `setsid` is present on that host at
  /usr/bin/setsid and on PATH; Java's ProcessBuilder reports a missing
  working directory by naming the program, so the message accuses the one
  thing that was fine. The coordinator was blocked for a shift on a false
  diagnosis, and the flag that exists to make an expedite run inspectable is
  the flag that cannot be run.

  The fix is a guard, not a redesign: the driver must be as dry as its
  siblings. A real run must keep driving stages exactly as it does today.

  Background:
    Given a ticket eligible for an expedited run

  # BL-1304 a-dry-run-spawns-nothing-01
  Scenario Outline: a dry run starts no stage, whatever an earlier run left behind
    Given a run worktree for that ticket is <worktree state>
    When the expeditor is invoked with --dry-run
    Then no stage process is started
    And no run worktree is created for that ticket
    And the run reports its plan and succeeds

    Examples:
      | worktree state              |
      | absent                      |
      | present from an earlier run |

  # BL-1304 a-dry-run-spawns-nothing-02
  Scenario: a dry run moves no ticket
    Given the run ticket is in backlog/paused/ and another ticket is in backlog/active/
    When the expeditor is invoked with --dry-run
    Then the run ticket is still in backlog/paused/
    And the other ticket is still in backlog/active/

  # BL-1304 a-dry-run-spawns-nothing-03
  Scenario: a real run still drives its stages
    When the expeditor is invoked without --dry-run
    Then the stage driver runs the chain
