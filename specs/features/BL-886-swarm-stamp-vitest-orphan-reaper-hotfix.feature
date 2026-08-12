Feature: BL-886 stamp: property-lane vitest crash-orphan reaping across supervisor, janitor, and fixture runner
  Review-stamp of human-landed commits 602c7d014 + 1ecbe049f (one logical
  unit): the supervisor's crash-orphan reaper and the janitor's periodic
  sweep now both cover property-lane vitest trees, and the fixture runner
  cleans up its generated files on abnormal exit.

  # BL-886 vitest-orphan-reaper-stamp-01
  Scenario Outline: the supervisor reaps a crash-orphaned property-lane group under any covered cmdline shape
    Given a process group whose root cmdline is "<cmdline>" and whose cwd is under a registered worktree
    And the group's parent process is gone
    When the supervisor's orphaned-job sweep runs
    Then the group is reaped

    Examples:
      | cmdline                                                    |
      | npm exec vitest run --config vitest.properties.config.mjs |
      | npx vitest run --config vitest.properties.config.mjs      |
      | node (vitest 3) worker                                    |

  # BL-886 vitest-orphan-reaper-stamp-02
  Scenario: a live-parented property-lane run is never touched by the supervisor reaper
    Given a property-lane vitest group whose parent process is alive
    And the group has been running longer than every stale threshold
    When the supervisor's orphaned-job sweep runs
    Then the group survives

  # BL-886 vitest-orphan-reaper-stamp-03
  Scenario: the supervisor's cwd match never widens scope beyond the project
    Given a parent-orphaned vitest group whose cmdline and cwd are both outside the host root and every registered worktree
    When the supervisor's orphaned-job sweep runs
    Then the group survives

  # BL-886 vitest-orphan-reaper-stamp-04
  Scenario Outline: the janitor sweep gates hung vitest trees on parenthood and staleness
    Given a project-scoped hung vitest tree whose parent is <parent-state>
    And its age relative to the vitest stale threshold is <age>
    When the janitor sweep runs
    Then the tree <outcome>

    Examples:
      | parent-state | age     | outcome  |
      | gone         | younger | is reaped |
      | alive        | younger | survives  |
      | alive        | older   | is reaped |

  # BL-886 vitest-orphan-reaper-stamp-05
  Scenario: the janitor honors the env-overridable vitest stale threshold
    Given SWARMFORGE_ORPHAN_JANITOR_VITEST_STALE_HOURS is set to a custom value
    And a live-parented project-scoped hung vitest tree older than that custom threshold
    When the janitor sweep runs
    Then the tree is reaped

  # BL-886 vitest-orphan-reaper-stamp-06
  Scenario: the fixture runner removes generated fixture files on abnormal termination
    Given a property-lane fixture run that has generated fixture test files
    When the process receives SIGTERM before the run's finally block executes
    Then no generated fixture file remains on disk

  # BL-886 vitest-orphan-reaper-stamp-07
  Scenario: repeated fixture runs install the cleanup handlers exactly once
    Given runAsPropertyLaneFixture completes twice within one process
    When the process exits
    Then the cleanup handler fires exactly once
    And no listener accumulation warning is emitted
