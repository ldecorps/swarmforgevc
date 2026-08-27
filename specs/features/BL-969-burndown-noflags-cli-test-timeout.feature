Feature: the no-flags burndown CLI test carries a timeout covering its real cost

  The compiled render-briefing-burndown CLI, run with no flags, derives
  burndown history from the real repo's git log and renders a PNG through
  the real mermaidRender.ts path - the same heavy work as its two
  BL-914-covered siblings in the same file - but was left on the 20000ms
  suite default: BL-914's inventory miscounted it among the fixture-snapshot
  fast tests. Measured 2026-08-20: it timed out at 20000ms while its work
  took 50.8s under live-swarm host load (the hardener measured ~23s at
  lower load). Structural contract only, same posture as BL-914's feature:
  pin that the override exists with real headroom and that the suite-wide
  default is untouched - not whether the headroom holds under any given
  load (that is the ticket's qa_e2e_procedure, a timing question).

  Background:
    Given the extension unit suite's vitest config declares a suite-wide default timeout

  # BL-969 burndown-noflags-cli-test-timeout-01
  Scenario: the no-flags CLI test declares its own generous per-test timeout
    Given the test "the compiled CLI runs with no flags at all against the real repo (unchanged pre-BL-897 behavior)" in "extension/test/renderBriefingBurndownCli.test.js"
    When the test file is inspected
    Then the test declares an explicit per-test timeout
    And the declared timeout is at least 60000 milliseconds
    And the declared timeout stays within one order of magnitude of the suite-wide default

  # BL-969 burndown-noflags-cli-test-timeout-02
  Scenario: the fix never raises the suite-wide default
    When the vitest config is inspected
    Then the suite-wide default timeout is still 20000 milliseconds
