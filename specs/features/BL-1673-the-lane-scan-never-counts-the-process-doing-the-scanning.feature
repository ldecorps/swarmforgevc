Feature: BL-1673 The lane scan never counts the process doing the scanning

  lane-running? (BL-1652) reads true for any process whose command line
  matches the lane pattern and is scoped to the worktree, including the
  process performing the scan. A bb probe that names the worktree in its
  own argv and, under a Stryker sandbox, carries a load-file path under
  .stryker-tmp/ therefore reads true for an empty worktree, and the wiring
  test's "no matching lane process reads false" case is red on every
  extension mutation dry run. This feature is that the scanning process is
  never counted, that every other process is classified as before, and
  that the regression case is pinned by name.

  Background:
    Given a fresh empty worktree directory under mkdtemp

  # BL-1673 the-scan-never-counts-itself-01
  Scenario Outline: the scanning process's own argv never makes the worktree read as running
    When lane-running? is asked about the worktree by a bb process whose own argv <argv>
    Then it prints <verdict>

    Examples:
      | argv                                                            | verdict |
      | names the worktree and carries no lane-pattern token           | false   |
      | names the worktree and carries a .stryker-tmp/ path token      | false   |
      | names nothing while a run_acceptance.sh child runs with its cwd under the worktree | true    |

  # BL-1673 the-daemons-own-read-is-unchanged-02
  Scenario: handoffd's role-lane-running? reads false for a quiet worktree even when its probe's argv carries a .stryker-tmp/ token
    When handoffd's role-lane-running? is probed for the worktree through a bb process whose argv carries a .stryker-tmp/ path token
    Then it prints false

  # BL-1673 the-regression-case-is-pinned-03
  # Census pin (BL-1445): the case is named literally; a runner that lost it would still report all passed.
  Scenario: the lane-process unit test carries the self-count case by name
    When the laneProcessLib unit test file runs
    Then it reports every test passed
    And its passing tests include the scan never counts its own process
