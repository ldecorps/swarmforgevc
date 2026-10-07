Feature: A Stryker survivor is re-checked by a command, not by hand
  Three hardener passes in five days (BL-1858, BL-1880, BL-1911) found
  Stryker reporting mutants as Survived that a test which executes the
  mutated line does kill: the hardener applied each mutant to the compiled
  file by hand and ran the test file directly. BL-1880 saw it with
  coverageAnalysis all as well as perTest, so it is not only per-test
  attribution. A command does that re-check for every survivor in a report,
  on a copy, so the hardener writes tests only for real survivors.

  Background:
    Given a fixture module whose compiled file returns a fixed reason string
    And a Stryker report that lists one Survived mutant blanking that string

  # BL-2063 stryker-survivor-recheck-01
  Scenario Outline: a reported survivor is run directly against the named test file
    Given the fixture's test file <checks> the reason string
    When the survivor re-check runs over the report with that test file
    Then the mutant is classified <verdict>

    Examples:
      | checks        | verdict                    |
      | asserts       | killed-when-run-directly   |
      | does not read | survived-when-run-directly |

  # BL-2063 stryker-survivor-recheck-02
  Scenario: the re-check leaves the compiled file byte-identical
    Given the fixture's test file asserts the reason string
    When the survivor re-check runs over the report with that test file
    Then the fixture module's compiled file is byte-identical to before the run

  # BL-2063 stryker-survivor-recheck-03
  Scenario: a survivor whose file changed since the report is stale and never applied
    Given the fixture's test file asserts the reason string
    And the fixture module's compiled file changed after the report was written
    When the survivor re-check runs over the report with that test file
    Then the mutant is classified stale
