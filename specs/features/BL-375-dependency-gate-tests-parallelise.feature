Feature: Dependency-gate tests parallelise across workers instead of bounding the suite

  BL-259 pins the REAL dependency-cruiser against the REAL project ruleset, so these
  assertions are legitimately expensive and must never be mocked away. The defect is
  not that they are slow — it is that ~12 of them boot the real engine SERIALLY inside
  one file, so that single file alone sets the whole suite's wall clock (10.0s of a
  12.0s run). Splitting the file lets the worker pool run them concurrently without
  weakening a single assertion.

  Background:
    Given the dependency-gate tests are spread across more than one test file

  # BL-375 dependency-gate-tests-parallelise-01
  Scenario: The split loses no test
    When I count every test across all dependency-gate test files
    Then the total equals the 12 tests the single pre-split file held

  # BL-375 dependency-gate-tests-parallelise-02
  Scenario Outline: Every real-engine test still drives the real pinned checker
    When I inspect the real-engine test "<test>"
    Then it runs the real pinned dependency-cruiser against the real project ruleset
    And nothing in its file mocks, stubs, or fakes the dependency-cruiser engine

    Examples:
      | test                      |
      | clean-fixture-passes      |
      | every-forbidden-rule      |
      | byte-identical-reports    |
      | localstorage-global       |
      | sessionstorage-global     |
      | per-parcel-single-file    |

  # BL-375 dependency-gate-tests-parallelise-03
  Scenario: No single file carries enough real-engine tests to bound the suite alone
    When I group the real-engine tests by the file holding them
    Then no file holds more than 2 of them
