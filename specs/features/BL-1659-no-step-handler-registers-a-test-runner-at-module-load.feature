Feature: BL-1659 No step handler registers a test runner at module load, and fixture cleanup runs through the runtime's disposal

  Seventy-five step handlers require node:test at module load to register
  an afterEach or after hook that removes their fixture roots. The
  acceptance runtime is not node:test: it runs no such hook, so those
  cleanups never fire (67 of them remove fixture roots - a share of the
  686,946 roots BL-1636 found leaked in /tmp), while the runner node:test
  installs prints a TAP epilogue and a MaxListenersExceededWarning on
  every acceptance and property-lane run. After this parcel every handler
  disposes what it creates through the runtime's own per-scenario
  disposal or tracks the root for reaping, no handler requires node:test
  at load, and the guard BL-1630 landed names any handler that does.

  # BL-1659 the-tree-loads-no-test-runner-01
  # Census pin (BL-1445): the count is asserted, so a derivation that finds a handful cannot pass.
  Scenario: every step handler is required in a fresh child and none loads node:test at module load
    When every step handler is required in one fresh child process with the loader intercept
    Then no handler loads node:test during its require
    And the census counts at least 1200 handlers

  # BL-1659 a-runner-at-load-is-named-02
  Scenario: the module-load budget guard names a fixture handler that requires node:test at load
    When the guard runs the require census over a fixture handler that requires node:test at module load
    Then it names that handler as a violation

  # BL-1659 the-registry-load-prints-no-tap-epilogue-03
  Scenario: requiring the step registry in a fresh child prints no test-runner epilogue
    When the step registry index is required in a fresh child process
    Then the child's output carries no TAP version line and no MaxListenersExceededWarning

  # BL-1659 the-disposal-recipe-removes-the-root-04
  Scenario: a handler that registers its fixture root with the runtime's disposal leaves no root behind
    Given a fixture step handler that creates a fixture root in a Given step and registers its removal through the runtime's disposal
    When its scenario runs through the runtime
    Then the disposal record names the root
    And the root no longer exists
