Feature: A unit-lane test budget is relative to recorded contention

  An absolute wall-clock budget silently encodes the host contention it was
  measured at. These scenarios pin what must hold instead: one budget
  function covering idle, contended, clamped and unreadable hosts, a finite
  ceiling, recorded attribution for every decision, and two boundaries the
  change must not cross.

  Background:
    Given the unit lane samples a host contention factor at run start
    And the lane declares an absolute ceiling for any effective budget

  # BL-1007 unit-lane-contention-budget-01
  Scenario Outline: the effective budget follows the recorded contention factor
    Given a unit-lane test whose base budget is <base> ms
    When the recorded contention factor is <factor>
    Then its effective budget is <effective>

    Examples:
      | base  | factor   | effective |
      | 20000 | 0.25     | 20000     |
      | 20000 | 1        | 20000     |
      | 20000 | 2        | 40000     |
      | 20000 | 3        | 60000     |
      | 45000 | 2        | 90000     |
      | 20000 | 1000     | ceiling   |
      | 20000 | unusable | 20000     |

  # BL-1007 unit-lane-contention-budget-02
  Scenario: the declared ceiling is a finite number
    When the lane's declared absolute ceiling is read
    Then it is a finite number of milliseconds

  # BL-1007 unit-lane-contention-budget-03
  Scenario: every budget decision is recorded for attribution
    When the unit lane completes a run
    Then the run's evidence names the contention factor it applied
    And the run's evidence names each budgeted test's load-normalized duration

  # BL-1007 unit-lane-contention-budget-04
  Scenario: each call site keeps a base budget readable from source text
    Given a unit-lane test file whose source declares an explicit base budget
    When the existing source-parsing timeout guard reads that file
    Then it reports the base budget as a numeric literal

  # BL-1007 unit-lane-contention-budget-05
  Scenario: the property lane is not scaled
    Given the property lane declares its own budget
    When the property lane runs under that same recorded contention factor
    Then the property lane budget is unchanged
