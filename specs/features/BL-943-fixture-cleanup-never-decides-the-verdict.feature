# Fixture cleanup never decides a daemon-fixture wiring test's verdict.
#
# Six self-contained handoffd wiring tests end each scenario with a
# trap clear followed by a bare cleanup call. Under set -euo pipefail
# the cleanup function's exit status is its trailing recursive remove,
# so a cleanup failure aborts the whole script at that line: a run
# whose assertions all passed reports a non-zero exit, never prints
# its final all-passed line, silently skips every later scenario, and
# leaks the fixture root the failed remove was meant to delete.
Feature: A shell test's verdict comes from its assertions, not its fixture cleanup

  Background:
    Given a fixture-cleanup failure can be injected without altering filesystem permission bits

  # BL-943 fixture-cleanup-verdict-01
  Scenario Outline: A failing fixture cleanup never fails an otherwise-passing run
    Given the daemon-fixture wiring test "<script>"
    And every assertion in it passes
    And its fixture cleanup is forced to fail
    When the test is run
    Then the run exits zero
    And the run prints its final all-scenarios-passed line

    Examples:
      | script                                       |
      | test_handoffd_aged_note_rotate_wiring.sh     |
      | test_handoffd_ambulance_wiring.sh            |
      | test_handoffd_rule_proposal_rotate_wiring.sh |
      | test_handoffd_wake_attribution_wiring.sh     |
      | test_handoffd_priority_rotate_wiring.sh      |
      | test_handoffd_starve_rotate_wiring.sh        |

  # BL-943 fixture-cleanup-verdict-02
  Scenario: A failing cleanup in an early scenario never skips the scenarios after it
    Given the daemon-fixture wiring test "test_handoffd_starve_rotate_wiring.sh"
    And the fixture cleanup of its first scenario is forced to fail
    When the test is run
    Then every one of its scenarios prints a passed line

  # BL-943 fixture-cleanup-verdict-03
  Scenario: A cleanup failure is reported rather than swallowed
    Given the daemon-fixture wiring test "test_handoffd_aged_note_rotate_wiring.sh"
    And its fixture cleanup is forced to fail
    When the test is run
    Then a warning naming the surviving fixture root is written to standard error

  # BL-943 fixture-cleanup-verdict-04
  Scenario: A genuine assertion failure still fails the run
    Given the daemon-fixture wiring test "test_handoffd_aged_note_rotate_wiring.sh"
    And one of its assertions is forced to fail
    And its fixture cleanup is forced to fail
    When the test is run
    Then the run exits non-zero
    And the run prints a failed line naming the assertion
