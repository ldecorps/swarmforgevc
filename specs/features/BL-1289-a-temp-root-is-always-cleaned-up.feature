Feature: Every bb and shell test runner cleans up the temp root it creates

  extension/test/tempDirTrapGuard.test.js scans swarmforge/scripts and fails
  on any runner that creates a temp root with no cleanup path. It currently
  reports 21 violations, so the guard is a standing red in the UNIT lane.

  The property-lane sibling (tempDirTrapGuard.property.test.js) is on the
  BL-1175 standing allowlist as "worktree scan noise"; this unit-lane one is
  NOT allowlisted and its findings are real files in swarmforge/scripts.

  Nothing traps SIGKILL, so a killed run always leaves its temp root behind -
  which is why the convention is a cleanup path AND a sweep by prefix before
  the next run, not cleanup alone.

  Background:
    Given the tempDirTrapGuard scan over swarmforge/scripts

  # BL-1289 temp-root-cleanup-01
  Scenario Outline: A runner that creates a temp root declares how it is removed
    Given a runner that creates a temp root with <mechanism>
    When the guard scans it
    Then the runner is <verdict> a violation

    Examples:
      | mechanism                   | verdict         |
      | a cleanup path on exit      | not reported as |
      | no cleanup path of any kind | reported as     |

  # BL-1289 temp-root-cleanup-02
  Scenario: The guard reports zero violations across swarmforge/scripts
    Given every runner under swarmforge/scripts
    When the guard scans the tree
    Then it reports no violations at all

  # BL-1289 temp-root-cleanup-03
  # The cleanup path is necessary but not sufficient - a killed run traps
  # nothing, so the next run must not inherit the previous one's leftovers.
  Scenario: A leftover temp root from a killed run does not survive the next run
    Given a temp root left behind by a run that was killed
    When a later run of the same runner starts
    Then that leftover root is gone before the run makes any assertion
