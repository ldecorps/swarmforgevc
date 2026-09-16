Feature: BL-1600 The shipped-step collision scan gets the unit lane's contention budget

  The bl1277 guard's shipped-step scan requires about 940 handler files
  through the real registry and ran 23.5 seconds under a swarm load of 10.8
  against the unit lane's flat 20-second timeout, while QA's lower-load run
  the same morning had it green. This feature is that the scan's budget is
  derived from its 20-second base through the unit lane's contention rule,
  so a quiet host keeps 20 seconds and a loaded one gets more, never above
  the lane's ceiling. The file's green runs are QA's e2e step.

  # BL-1600 shipped-step-scan-contention-budget-01
  Scenario: the shipped-scan test declares its budget through the contention helper from a 20000 ms base
    When the source of extension/test/bl1277UnscopedStepCollisionGuard.test.js is read
    Then exactly one test in it declares a per-test timeout
    And that test is the shipped-step scan and its timeout is derived from 20000 ms through resolveUnitLaneTimeout, never a bare literal

  # BL-1600 shipped-step-scan-contention-budget-02
  Scenario Outline: the derived budget scales with recorded contention and never past the ceiling
    Given a recorded contention factor of <factor>
    When the unit lane timeout is resolved from a 20000 ms base
    Then the effective budget is <budget> ms

    Examples:
      | factor | budget |
      | 0.5    | 20000  |
      | 1      | 20000  |
      | 2.5    | 50000  |
      | 9      | 120000 |
