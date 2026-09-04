Feature: BL-1388 The land-step runner's tree-guard fixture describes the guard as it stands

  The land-step runner pins that a tip-pure replay really reaches the
  feature-handler registration guard on a non-main tree. Its fixture builds
  the refusal case with a hand-written registry array that lists no handler,
  which was unregistered under the hand-maintained array and is registered
  under discovery. The guard is right and the runner has been red since
  discovery landed. This feature is that the runner is green, that its
  refusal case is a handler discovery cannot reach, and that a discoverable
  handler beside an empty array is not refused.

  Background:
    Given a scratch tree on a land-replay branch with a feature file and one handler

  # BL-1388 the-runner-is-green-01
  Scenario: the land-step runner passes on main
    When the land-step test runner runs
    Then it exits zero with no failing assertion

  # BL-1388 an-undiscoverable-handler-is-refused-02
  Scenario Outline: the real tree guard refuses a handler discovery cannot reach
    Given the handler is <placement>
    When the replayed tree guards run against the scratch tree
    Then the guards refuse
    And the refusal names the feature file

    Examples:
      | placement                                       |
      | nested in a subdirectory of the steps directory |
      | named without the Steps.js suffix               |

  # BL-1388 moving-it-into-reach-clears-the-refusal-03
  Scenario: moving the handler where discovery reaches it clears the refusal
    Given the handler is nested in a subdirectory of the steps directory
    And the replayed tree guards refused the scratch tree
    When the handler is moved to the top of the steps directory
    Then the replayed tree guards pass

  # BL-1388 a-discoverable-handler-beside-an-empty-array-passes-04
  Scenario: a discoverable handler beside an empty registry array is not refused
    Given the handler is at the top of the steps directory
    And the tree carries a registry file whose array lists no handler
    When the replayed tree guards run against the scratch tree
    Then the replayed tree guards pass
