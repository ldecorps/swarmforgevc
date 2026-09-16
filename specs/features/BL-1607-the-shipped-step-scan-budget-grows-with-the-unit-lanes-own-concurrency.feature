Feature: BL-1607 The shipped-step collision scan's budget grows with the unit lane's own concurrency

  BL-1600 (landed 3e5884b9bc, 2026-09-16) gave bl1277's shipped-step scan
  a budget derived from 20000 ms through resolveUnitLaneTimeout, whose
  default factor is the 1-minute load average divided by the core count.
  On this 20-core host that factor stays under 1 at every load recorded
  here (idle 2.3 to 3.6, a full lane 7 to 10.8, BL-1579's measurement),
  so the budget resolved exactly 20000 ms and the scan timed out again
  the same afternoon in QA's full unit lane on the BL-1598 parcel (commit
  771b9cdd6d, "Test timed out in 20000ms"), green alone in 7.9 seconds.
  The property lane already folds its own fork count and a quiet-band
  load denominator into its factor (BL-1579, BL-1588); the unit lane
  publishes no fork count and has no such route. This feature is that the
  unit lane publishes its resolved fork count before any fork spawns, that
  the scan's budget is derived from its 20000 ms base through
  resolveUnitLaneTimeout with a factor that reads that fork count and the
  quiet-band load the way the property lane's does, so a quiet host with
  one fork keeps exactly 20000 ms and a nine-fork lane gets more, and that
  the evidence records the full-lane text and the remedy. The file's own
  green runs are QA's e2e step (BL-1541).

  # BL-1607 shipped-step-scan-budget-grows-with-lane-concurrency-01
  Scenario: the scan's budget still derives from 20000 ms through resolveUnitLaneTimeout and now names the unit lane's fork-aware factor
    When the source of extension/test/bl1277UnscopedStepCollisionGuard.test.js is read
    Then exactly one test in it declares a per-test timeout
    And that test is the shipped-step scan and its timeout is derived from 20000 ms through resolveUnitLaneTimeout with the unit lane's fork-aware contention factor, never the core-count default

  # BL-1607 shipped-step-scan-budget-grows-with-lane-concurrency-02
  Scenario Outline: the scan's budget reflects the unit lane's published fork count and the quiet-band load
    Given the unit lane has published <forks> worker forks
    And the host's 1-minute load average reads <load>
    When the shipped-step scan's budget is resolved from its 20000 ms base
    Then the effective budget is <budget> ms

    Examples:
      | forks | load | budget |
      | 1     | 1.8  | 20000  |
      | 1     | 3.6  | 20000  |
      | 9     | 1.8  | 45000  |
      | 9     | 10.8 | 54000  |
      | 1     | 10.8 | 54000  |
      | 40    | 1.8  | 120000 |

  # BL-1607 shipped-step-scan-budget-grows-with-lane-concurrency-03
  Scenario: the unit lane config publishes its fork count through the shared lane-forks rule
    When the source of extension/vitest.config.mjs is read
    Then it publishes the unit lane's fork count to the environment before the config is defined
    And that count is resolved through the property lane helper's resolveLaneForks from the invocation's explicit file arguments and the pool ceiling, never a copy of its math

  # BL-1607 shipped-step-scan-budget-grows-with-lane-concurrency-04
  Scenario: the parcel's evidence records the full-lane failure and its remedy
    When BL-1607's evidence file is read
    Then it records the failing test name and the timeout message verbatim from a full unit-lane run and the change that removed it
