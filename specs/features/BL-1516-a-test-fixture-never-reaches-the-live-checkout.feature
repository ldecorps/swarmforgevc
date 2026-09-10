Feature: BL-1516 a test fixture never reaches the live checkout
  A fixture root is proven under its mkdtemp before the first mutating git
  command, a probe placeholder root never resolves against cwd, and the
  standing suite runner fails loud on any top-level entry a test leaves
  behind in the checkout it runs from.

  # BL-1516 fixture-root-proof-01
  Scenario: a fixture whose root is not a repository under its tmproot aborts before mutating
    Given the BL-1378 fixture builder is given a root whose git common dir does not resolve under its TMPROOT
    When the fixture builder runs
    Then it exits non-zero with one line naming that root
    And no branch, commit or index change exists in the enclosing repository

  # BL-1516 fixture-root-proof-02
  Scenario: a proven fixture root builds as before
    Given the BL-1378 fixture builder is given a fresh mkdtemp root
    When the fixture builder runs
    Then the fixture repository is initialised under that root
    And the enclosing repository is unchanged

  # BL-1516 probe-placeholder-03
  Scenario: the handoffd probe placeholder never writes under cwd
    Given handoffd.bb is loaded under a probe with no root argument
    When post-qa-branch-sweep-tell is driven for a role
    Then no entry named "bl1395-load-probe-no-root" exists at the top level of the current directory
    And the daemon log it wrote resolves to an absolute path outside the current directory

  # BL-1516 suite-census-04
  Scenario Outline: the standing suite runner reports a test that leaves a top-level entry behind
    Given a checkout with a planted standing test that creates a top-level entry "<entry>"
    When run_bb_suite.sh runs
    Then a line "ROOT_POLLUTION_DETECTED test=<test> entry=<entry>" is printed
    And the runner exits non-zero although every test passed

    Examples:
      | test               | entry           |
      | test_planted.sh    | planted-entry   |
      | test_planted_bb.bb | --planted-flag  |

  # BL-1516 suite-census-05
  Scenario: a clean suite run prints no census line
    Given a checkout whose standing tests leave no top-level entry behind
    When run_bb_suite.sh runs
    Then no line starting "ROOT_POLLUTION_DETECTED" is printed
    And the runner exits as it did before this ticket
