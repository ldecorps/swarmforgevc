Feature: BL-1618 One verification command per role encodes the lane set

  On 2026-09-16/17 six roles each ran the full unit lane, the 320 s
  property lane and the acceptance run on every parcel, at cap 5-6 on one
  host: hours of wall-clock, and under that load the property lane's flat
  timeout fired reds that became tickets that QA verified by re-running
  the slow test twenty times. The human: "each role has to be more careful
  about each tests to run ... Architect has to ensure that the dependencies
  are such that changing a small area of the code does not mean running
  hours long test suites." Prose in five prompts is discipline; this
  feature is the mechanism: one script holds the lane table, prints the
  plan for a role, runs exactly that plan sequentially, and refuses an
  unknown role rather than running everything.

  Background:
    Given a fixture checkout with a recording fake npm and a recording fake run_acceptance.sh on PATH
    And the parcel's ticket names one acceptance feature file

  # BL-1618 one-verification-command-per-role-01
  Scenario Outline: the plan for a role is its lane set and nothing else
    Given the parcel changed <paths>
    When verify_lanes.sh is asked for the plan of role <role>
    Then the plan lists exactly <lanes>

    Examples:
      | role       | paths                                | lanes                                          |
      | coder      | extension/src and extension/test     | compile, unit, properties, acceptance-own      |
      | cleaner    | extension/src                        | compile, unit, acceptance-own                  |
      | cleaner    | docs only                            | compile, acceptance-own                        |
      | architect  | one property test file               | compile, unit, properties, acceptance-own      |
      | documenter | docs only                            | compile, acceptance-own                        |
      | hardender  | extension/src                        | compile, unit, mutation, acceptance-own        |
      | QA         | extension/src                        | compile, unit, changed-path, properties, acceptance-own |

  # BL-1618 one-verification-command-per-role-02
  Scenario: the run executes the plan, in order, sequentially, and fails when a lane fails
    Given the parcel changed extension/src
    And the fake npm fails its unit lane
    When verify_lanes.sh runs for role cleaner
    Then the recorded invocations are compile then unit and nothing after
    And the exit status is non-zero and the verdict names the failed lane

  # BL-1618 one-verification-command-per-role-03
  Scenario Outline: the role comes from the seat when not given, and an unknown role is refused
    Given SWARMFORGE_ROLE is <seat>
    When verify_lanes.sh is asked for the plan with no role argument
    Then it <outcome>

    Examples:
      | seat       | outcome                                                  |
      | documenter | prints the documenter plan                               |
      | coder@2    | prints the coder plan                                    |
      | gardener   | refuses naming the unknown role and runs no lane at all |
