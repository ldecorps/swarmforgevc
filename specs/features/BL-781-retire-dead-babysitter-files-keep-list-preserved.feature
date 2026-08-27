Feature: Dead babysitter wake-runtime files are deleted and scenario 15 is no longer vacuous

  # BL-781: BL-611 scenario 15 asserts no wake runtime remains, but its step
  # handler allowlists the two surviving wake-runtime files. Delete the dead
  # files and drop the allowlist exemptions so the scan enforces the assertion.

  Background:
    Given the repo at the parcel commit

  # BL-781 dead-files-absent-01
  Scenario Outline: retired wake-runtime babysitter files are absent from the tree
    When the tree is searched for "<path>"
    Then that path does not exist

    Examples:
      | path                                         |
      | swarmforge/scripts/babysitter_lib.bb         |
      | swarmforge/scripts/babysitter_enqueue_wake.sh |
      | swarmforge/scripts/babysitter_assess.bb      |

  # BL-781 dedicated-test-runners-removed-02
  Scenario: the babysitter_lib test runner is absent when its only subject was deleted
    When the tree is searched for "swarmforge/scripts/test/babysitter_lib_test_runner.bb"
    Then that path does not exist

  # BL-781 scenario-15-allowlist-03
  Scenario: the BL-611 scenario 15 allowlist no longer exempts deleted wake-runtime files
    Given the BL-611 scenario 15 step handler allowlist at the parcel commit
    When the allowlist paths are read
    Then the allowlist does not name any deleted wake-runtime babysitter file

  # BL-781 bl611-scenario-15-still-passes-04
  Scenario: BL-611 scenario 15 still passes without allowlisting wake runtime
    When BL-611 scenario 15 is run against the parcel commit
    Then every step passes

  # BL-781 live-libraries-survive-05
  Scenario Outline: salvaged pure babysitter libraries remain and their suites pass
    When the tree is searched for "<path>"
    Then that path exists
    And "<test_runner>" reports ALL PASS

    Examples:
      | path                                            | test_runner                                                  |
      | swarmforge/scripts/babysitter_assess_lib.bb     | swarmforge/scripts/test/babysitter_assess_lib_test_runner.bb |
      | swarmforge/scripts/babysitter_nudge_lib.bb      | swarmforge/scripts/test/babysitter_nudge_lib_test_runner.bb  |
      | swarmforge/scripts/babysitter_nudge_resident.bb | swarmforge/scripts/test/test_babysitter_nudge_resident.sh    |

  # BL-781 lifecycle-scripts-clean-06
  Scenario: start, stop, and ensure scripts run clean after the deletions
    When ./start-swarm.sh, ./stop-swarm.sh, and ./swarm ensure run
    Then none of them error on a missing reference to a removed file

  # BL-781 no-live-callers-07
  Scenario Outline: repo-wide grep finds no live caller of each deleted filename
    When a repo-wide search is run for "<basename>" excluding history and docs
    Then every match is absent or is only a historical backlog or docs reference

    Examples:
      | basename                  |
      | babysitter_lib.bb         |
      | babysitter_enqueue_wake.sh |
      | babysitter_assess.bb      |
