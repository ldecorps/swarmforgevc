Feature: BL-1972 A unit test run on a stale build stops before any test

  The unit tests load the compiled extension/out/, which is gitignored and
  rebuilt only by npm run compile. npm test compiles first; a role that runs
  one file directly with npx vitest run does not. On 2026-10-04 the
  documenter ran the formatHelpMessage test that way on a worktree whose
  out/ predated hotfix eb5fc34a08: the compiled help text lacked the /gpu
  line that both the source and the test carry, the assertion diff was read
  backwards, and BL-1951 was bounced to the coder for a defect that did not
  exist. The iq3 coder spent more than an hour trying to explain it.

  Background:
    Given an extension fixture with a source file and its compiled output

  # BL-1972 the-default-unit-configuration-carries-the-check-01
  Scenario: the configuration npx vitest run uses carries the check
    When the default unit test configuration is loaded
    Then its global setup includes the stale-build check

  # BL-1972 a-stale-build-stops-the-run-02
  Scenario: a source file newer than its compiled output stops the run naming the file
    Given the source file was changed after its compiled output was written
    When the unit test configuration's global setup runs
    Then the run stops before any test with a message naming that source file and npm run compile

  # BL-1972 a-fresh-build-runs-03
  Scenario: compiled output newer than every source file lets the run go on
    Given the compiled output was written after every source file
    When the unit test configuration's global setup runs
    Then the run goes on with no message
