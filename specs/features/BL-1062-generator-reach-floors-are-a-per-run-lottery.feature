Feature: BL-1062 a generator-reach floor is satisfiable by construction
  Two property tests assert that an unseeded random draw happened to cover every
  value of a small categorical space, and fail the run when it did not. Neither
  failure says anything about the code under test. bl968 asks for 5 draws of
  each of 3 classes in 24 runs; bl948 asks for all 3 death shapes in 12 runs.
  fast-check picks a fresh seed per run, so each run is a lottery against a
  floor a correct implementation cannot guarantee. The floors themselves are
  load-bearing - they are what keeps each property non-vacuous - so the fix is
  to make the coverage they demand reachable by construction, never to drop them.

  # BL-1062 reach-floor-satisfiable-01
  Scenario Outline: every declared reach floor is met on a correct implementation
    Given the implementation under test is correct
    When <test> runs repeatedly, each run drawing a different seed
    Then every declared reach floor is met on every run

    Examples:
      | test                              |
      | the materialized-guard sensitivity |
      | the socket-fixture death shape     |

  # BL-1062 reach-floor-satisfiable-02
  Scenario: a floor still fails when the generator stops reaching a class
    Given the generator is restricted so one class is never drawn
    When the test runs
    Then the test fails and names the class that was not reached

  # BL-1062 reach-floor-satisfiable-03
  Scenario: no floor was removed to reach green
    When the reach floors are inspected after the change
    Then each test still declares a floor for every value in its space
