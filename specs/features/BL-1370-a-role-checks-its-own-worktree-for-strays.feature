Feature: A role checks its own worktree for strays

  QA's prompt makes an orphan check a gate, not a courtesy: no leftover test or
  mutation processes before verification, because a run on top of one skews
  results and pins cores, and none alive after it, because an orphaned run
  reparents to the OS and burns cores for hours. Stragglers are reaped by
  process group, never by pid.

  Every part of that is fixed, and all of it is performed by hand. The hard
  part is not the check but the scope: a role must distinguish its own
  leftovers from another worktree's legitimate concurrent run, and get that
  wrong in the killing direction and it destroys a colleague's work in
  progress.

  The swarm already knows how to make that distinction - `process_table_lib`'s
  own classifier, which the orphan janitor and the supervisor both defer to so
  they cannot disagree. What is missing is a way for a role to ask it about its
  own pass.

  Background:
    Given a role is verifying in its own worktree

  # BL-1370 a-role-checks-its-own-worktree-for-strays-01
  Scenario: a clean worktree reports clean
    Given no test or mutation process is running for this worktree
    When the role checks for strays
    Then the check reports clean
    And the check succeeds

  # BL-1370 a-role-checks-its-own-worktree-for-strays-02
  Scenario: a stray in this worktree is named with its process group
    Given a leftover test process is running for this worktree
    When the role checks for strays
    Then the stray is named with its process group
    And the check fails

  # BL-1370 a-role-checks-its-own-worktree-for-strays-03
  Scenario: another worktree's running suite is never reported
    Given a test process is running for a different worktree
    When the role checks for strays
    Then the check reports clean

  # BL-1370 a-role-checks-its-own-worktree-for-strays-04
  Scenario: reaping kills the whole process group
    Given a leftover test process is running for this worktree
    When the role reaps its strays
    Then the stray's whole process group is killed
    And a later check reports clean

  # BL-1370 a-role-checks-its-own-worktree-for-strays-05
  Scenario: reaping never touches another worktree's processes
    Given a test process is running for a different worktree
    When the role reaps its strays
    Then that process is still running

  # BL-1370 a-role-checks-its-own-worktree-for-strays-06
  Scenario: the check yields the line the pass evidence has to record
    Given no test or mutation process is running for this worktree
    When the role checks for strays
    Then the check yields a recordable result naming what was scanned
