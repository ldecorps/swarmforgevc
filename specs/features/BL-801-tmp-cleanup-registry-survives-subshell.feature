Feature: BL-801 shared tmp cleanup registry survives command-substitution registration
  The shared shell test helper swarmforge/scripts/test/lib/tmp_cleanup.sh must
  sweep every registered temp root on the registering script's exit regardless
  of the shell depth the registration ran at, and its EXIT trap must never turn
  a passing test red on any supported bash (macOS /bin/bash 3.2.57 included).

  Background:
    Given a fixture test script that sources the shared tmp cleanup lib with "set -euo pipefail" active

  # BL-801 tmp-registry-survives-subshell-01
  Scenario Outline: a root registered inside a command-substitution helper is swept on either exit path
    Given the fixture's only registration happens inside a helper invoked via command substitution
    And the fixture is arranged so that <exit-path>
    When the fixture exits
    Then the fixture's exit code is <expected-exit>
    And the temp root created inside the helper no longer exists

    Examples:
      | exit-path                                 | expected-exit |
      | every assertion passes                    | 0             |
      | an assertion fails after the registration | non-zero      |

  # BL-801 tmp-registry-survives-subshell-02
  Scenario: a passing fixture with zero registrations exits 0
    Given the fixture registers no temp roots
    And every assertion in the fixture passes
    When the fixture exits
    Then the fixture's exit code is 0
    And the fixture's stderr carries no "unbound variable" error

  # BL-801 tmp-registry-survives-subshell-03
  Scenario: mixed direct and command-substitution registrations are all swept
    Given the fixture registers one temp root directly in the script body
    And the fixture registers another temp root inside a helper invoked via command substitution
    When the fixture exits
    Then the fixture's exit code is 0
    And neither temp root exists any more

  # BL-801 tmp-registry-survives-subshell-04
  Scenario: one script's exit never sweeps another running script's roots
    Given two fixture scripts have each registered their own temp root
    And the first fixture exits while the second is still running
    When the first fixture's cleanup runs
    Then the first fixture's temp root no longer exists
    And the second fixture's temp root still exists
