Feature: heavy real-work unit tests carry their own timeout instead of raising the global budget

  # BL-914 (swarm-reliability). Six unit tests across three files do real,
  # deliberately-unmocked work - the pinned dependency-cruiser run twice, real
  # mermaid layout plus native resvg PNG rendering, and real-repo git history
  # derivation. Each measures within a few percent of Vitest's 20000ms default
  # testTimeout even when isolated, so on a contended host they cross it and
  # fail as timeouts rather than as regressions.
  #
  # The fix is per-test headroom (Vitest's test(name, fn, { timeout }) third
  # argument), never a raise of the suite-wide default - the other ~7700 tests
  # are not this class of problem and must keep the tight budget that catches
  # a genuine hang.
  #
  # This is a STRUCTURAL contract: it pins that the overrides exist and that
  # the global default is untouched. Whether the headroom is actually enough
  # under real load is a timing question, not a Gherkin one - that lives in
  # the ticket's qa_e2e_procedure as isolated and full-suite measurement runs.
  #
  # Step handlers: specs/pipeline/steps/bl914PerTestTimeoutSteps.js, parsing
  # the real test files and vitest.config.mjs. The <file> column is validated
  # against explicit KNOWN_VALUES, never passed through.

  Background:
    Given the extension unit suite's vitest config declares a suite-wide default timeout

  # BL-914 per-test-timeout-01
  Scenario Outline: each heavy real-work test declares its own timeout
    Given the heavy real-work tests named by this ticket in "<file>"
    When the test file is inspected
    Then every one of those tests declares an explicit per-test timeout
    And each declared timeout is greater than the suite-wide default

    Examples:
      | file                                |
      | dependencyGateCliReportsAndScope    |
      | renderBriefingDiagramsCli           |
      | renderBriefingBurndownCli           |

  # BL-914 per-test-timeout-02
  Scenario: the suite-wide default is left alone
    When the vitest config is inspected
    Then the suite-wide default timeout is still 20000 milliseconds

  # BL-914 per-test-timeout-03
  # Deliberately NOT "no other test has an override": nine unrelated files
  # already carry one for their own reasons, so that assertion is false today
  # and would fail the gate on arrival. The real risk this pins is the lazy
  # fix - disabling the timeout outright rather than granting headroom.
  Scenario: the headroom is bounded, never a disabled timeout
    When every per-test timeout this ticket declares is inspected
    Then no declared timeout is zero or otherwise unbounded
    And each stays within one order of magnitude of the suite-wide default
