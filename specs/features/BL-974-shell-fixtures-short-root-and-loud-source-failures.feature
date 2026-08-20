Feature: BL-974 shell-test fixtures clear the socket path guard, and a source failure is never silent

  Shell tests that source swarmforge.sh inside a mktemp fixture die at source
  time on macOS: the fixture root under /var/folders is long enough that the
  derived control-socket path exceeds the 100-char unix-socket guard
  (BL-367, fail-closed by design). The guard fires before the behaviour under
  test is ever reached, and the affected helpers discard stderr while set -e
  preempts their own fail() diagnostics - so the test exits 1 with no failure
  line at all. BL-323's acceptance has been dark this way; BL-948 fixes the
  same defect class on the JS step-file surface.

  Background:
    Given the shell test tree "swarmforge/scripts/test"

  # BL-974 shell-fixtures-short-root-and-loud-source-failures-01
  Scenario: the BL-323 resume test runs green end to end
    When "swarmforge/scripts/test/test_resume_on_start.sh" runs
    Then it exits 0 and its final line is "ALL PASS"

  # BL-974 shell-fixtures-short-root-and-loud-source-failures-02
  Scenario: BL-323's acceptance scenarios are green again
    When the acceptance runner executes "specs/features/BL-323-resume-orphaned-inprocess-parcel.feature"
    Then all of its scenario runs pass

  # BL-974 shell-fixtures-short-root-and-loud-source-failures-03
  Scenario: a fixture root from the shared helper keeps socket paths inside the OS limit
    Given a fixture root created through the shared short-root helper
    When the control-socket path is derived for that root
    Then the derived socket path is at most 100 characters

  # BL-974 shell-fixtures-short-root-and-loud-source-failures-04
  Scenario: a source-time failure inside a test helper is loud
    Given a test helper whose sourced swarmforge.sh invocation is forced to fail
    When the test runs
    Then the test's failure output names the underlying error before the non-zero exit

  # BL-974 shell-fixtures-short-root-and-loud-source-failures-05
  Scenario: the inspection gate decides membership and stays non-vacuous
    Given a scratch shell test whose fixture sources swarmforge.sh from a long mktemp root without the shared helper
    When the short-root inspection gate runs over the shell test tree
    Then the gate fails naming that scratch test
