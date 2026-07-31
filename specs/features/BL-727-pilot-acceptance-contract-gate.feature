Feature: A piloted ticket cannot land without executing its own acceptance contract
  BL-718 landed through /pilot with a hand-authored feature file that had zero
  step handlers, so its acceptance contract would have thrown "no step handler
  matched" on the very first run — and nothing in the pilot ever ran it. The
  pilot declares a stage passed by writing prose into verdict.json; no gate
  executes the ticket's own named acceptance contract before the yaml moves to
  backlog/done/. This slice makes the land itself the gate: the pilot lands a
  ticket by invoking the acceptance-contract gate, which executes the ticket's
  declared feature file through the project's existing acceptance pipeline and
  moves the yaml only on a green run.

  Background:
    Given a piloted ticket whose yaml sits in backlog/active/
    And the acceptance-contract gate is the pilot's only landing path

  # BL-727 pilot-acceptance-gate-01
  Scenario Outline: an acceptance contract that does not pass refuses the land
    Given the ticket declares a feature file that <contract state>
    When the pilot lands the ticket
    Then the land is refused
    And the refusal names <named in refusal>

    Examples:
      | contract state                        | named in refusal      |
      | has a step no step handler matches    | the unmatched step    |
      | has a scenario whose assertion fails  | the failing scenario  |

  # BL-727 pilot-acceptance-gate-02
  Scenario: a ticket whose acceptance contract passes lands with a receipt
    Given the ticket declares a feature file whose every scenario passes
    When the pilot lands the ticket
    Then the ticket yaml is moved to backlog/done/
    And an acceptance receipt records the feature file, the landed commit, and the passing result

  # BL-727 pilot-acceptance-gate-03
  Scenario Outline: a ticket with no executable acceptance contract fails closed
    Given the ticket's acceptance declaration is <acceptance declaration>
    When the pilot lands the ticket
    Then the land is refused for having no executable acceptance contract

    Examples:
      | acceptance declaration                     |
      | absent                                     |
      | inline Gherkin text naming no feature file |
      | a feature file path that does not exist    |

  # BL-727 pilot-acceptance-gate-04
  Scenario: a refused land changes nothing on disk
    Given the ticket declares a feature file that has a step no step handler matches
    When the pilot lands the ticket
    Then the ticket yaml still sits in backlog/active/
    And no acceptance receipt is written for the ticket
