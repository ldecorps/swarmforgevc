Feature: BL-1517 a project-root argument is a repository or refused, and a test harness refuses a missing fixture root instead of falling back to the cwd
  A Babashka CLI taking <project-root> positionally checks the argument
  before binding it: blank, flag-shaped, not a directory, or not inside a
  git checkout is refused with usage and exit 2 before any write. A test
  harness under swarmforge/scripts/test that binds its fixture root the
  same way (absorbed from BL-889, 2026-09-21) refuses an absent root
  through the same check before any mailbox read, state write or handoff
  send, and a check that enumerates the harnesses keeps a new one from
  shipping the hazard again.

  # BL-1517 project-root-arg-01
  Scenario Outline: a root argument that is not a git checkout is refused before any write
    Given the current directory is a mkdtemp directory that is not a git checkout
    When "<cli>" is invoked with "<arg>" in its project-root position
    Then it exits 2
    And stderr carries a line "REFUSED project-root <arg>:" followed by a reason
    And the current directory has no new entry

    Examples:
      | cli                     | arg         |
      | main_sync_status_cli.bb | --help      |
      | operator_runtime.bb     | --tick-once |
      | operator_runtime.bb     | --check-once |
      | expedite_cli.bb         | unpark      |

  # BL-1517 project-root-arg-02
  Scenario: a valid root is accepted unchanged
    Given a fixture git checkout under mkdtemp
    When "main_sync_status_cli.bb" is invoked with that checkout as its project root
    Then it prints its JSON verdict as before
    And no REFUSED line is printed

  # BL-1517 project-root-arg-03
  Scenario: the expedite unpark subcommand checks its own root position
    Given the current directory is a mkdtemp directory that is not a git checkout
    When "expedite_cli.bb" is invoked as "unpark tmp/x run-dir"
    Then it exits 2
    And stderr carries a line "REFUSED project-root tmp/x:" followed by a reason
    And the current directory has no new entry

  # BL-1517 harness-refuses-missing-fixture-root-04
  Scenario Outline: a harness invoked with no fixture root refuses instead of using the working directory
    Given a scratch working directory that contains no ".swarmforge" state
    When the harness "<harness>" is invoked from that scratch working directory with no arguments
    Then it exits with a non-zero status
    And its standard error names the missing fixture root
    And no ".swarmforge" directory is created in the scratch working directory

    Examples:
      | harness                               |
      | dispatch_gap_sweep_harness.bb         |
      | dropped_parcel_sweep_harness.bb       |
      | commit_integrity_856_scenarios_cli.bb |

  # BL-1517 harness-refuses-missing-fixture-root-05
  Scenario: a harness invoked with a fixture root still sweeps that root and only that root
    Given a fixture project root whose roles are registered and whose coordinator inbox is empty
    And a dispatch gap in the fixture project root that the sweep is expected to nudge
    When the harness "dispatch_gap_sweep_harness.bb" is invoked with the fixture project root
    Then it exits with a zero status
    And the nudge is delivered into the fixture project root's coordinator inbox
    And the live repository's coordinator inbox is unchanged

  # BL-1517 harness-refuses-missing-fixture-root-06
  Scenario: a newly added harness that accepts a missing fixture root fails the check
    Given a harness under "swarmforge/scripts/test" that binds its fixture root from the command line
    And that harness is not named in any hardcoded list inside the check
    When the missing-fixture-root check runs
    Then that harness is included in the check
    And the check fails while that harness accepts a missing fixture root
