Feature: BL-1407 The property gate re-runs a red in isolation before it refuses

  The property-suite gate decides from one full run, so a file that goes red
  only under the full fork pool refuses a commit exactly like a regression,
  and the red leaves no trace. This feature is that a non-allowlisted red is
  re-run once alone before it may refuse: passing alone makes it a recorded
  flake and the commit is allowed; failing alone refuses as before, naming
  the file. Allowlisted files are never re-run and no file is re-run twice.

  Background:
    Given the property-suite gate running against a staged commit that touches no property file

  # BL-1407 a-red-that-passes-alone-is-a-recorded-flake-01
  Scenario: a non-allowlisted red that passes alone is recorded and the commit is allowed
    Given a non-allowlisted property file that fails in the full run and passes when run alone
    When the gate decides
    Then the commit is allowed
    And a flake record names the file, the commit, and that the commit did not touch the file

  # BL-1407 a-red-that-fails-alone-still-refuses-02
  Scenario: a non-allowlisted red that fails alone refuses naming the file
    Given a non-allowlisted property file that fails in the full run and fails again when run alone
    When the gate decides
    Then the commit is refused naming that file
    And no flake record is written

  # BL-1407 each-red-is-rerun-at-most-once-03
  Scenario: every red file is re-run exactly once and allowlisted reds are never re-run
    Given three non-allowlisted property files that fail in the full run
    And one allowlisted property file that fails in the full run
    When the gate decides
    Then each of the three files is re-run exactly once
    And the allowlisted file is not re-run

  # BL-1407 a-rerun-past-the-ceiling-counts-as-failed-04
  Scenario: a re-run that cannot complete within its ceiling counts as a failure
    Given a non-allowlisted property file that fails in the full run and hangs when run alone
    When the gate decides
    Then the commit is refused naming that file
