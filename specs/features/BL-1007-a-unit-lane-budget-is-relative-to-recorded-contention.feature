# mutation-stamp: sha256=7850396e8cb7c1b8f87e63e6fa667aafc0b335a93286d9637fa174d4182946d1
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T14:08:26.615839417Z","feature_name":"A unit-lane test budget is relative to recorded contention","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention.feature","background_hash":"65da3dbd89f67ca7ca00081551e2961f47145be78e25d86cd59ea8f6a898dd83","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the effective budget follows the recorded contention factor","scenario_hash":"4072b5a988059b213fb47c2cdf60c1b26ba5366db48612d121dce701d1b0f991","mutation_count":21,"result":{"Total":21,"Killed":21,"Survived":0,"Errors":0},"tested_at":"2026-08-24T14:08:26.615839417Z"}]}
# acceptance-mutation-manifest-end

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
