Feature: promotion refuses a ticket whose acceptance names no executable feature

  A ticket's acceptance field advertises a contract the coder runs and QA
  gates on. When it points at a file that is not there, or at a parked draft
  the runner will not execute, nothing errors: the ticket is promoted, worked,
  and can reach done with its stated acceptance never once executed.

  The gate closes that silence at promotion time, and names the offending
  path. A refusal that says only "blocked" reproduces the silence it removes.

  Background:
    Given a ticket eligible for promotion into the active backlog

  # BL-626 promotion-gate-01
  Scenario Outline: a candidate with no executable acceptance is refused by name
    Given the candidate's acceptance names <pointer>
    And <present> in specs/features/
    When the coordinator promotes the next eligible ticket
    Then the promotion is refused
    And the refusal names <named>

    Examples:
      | pointer           | present            | named                                 |
      | a feature file    | only its draft     | the missing feature and its draft     |
      | its own draft     | that draft         | the draft as not executable           |
      | a feature file    | no matching file   | the missing feature                   |

  # BL-626 promotion-gate-02
  Scenario: an acceptance that resolves is promoted with no new friction
    Given the candidate's acceptance names a feature file that exists
    When the coordinator promotes the next eligible ticket
    Then the candidate is promoted

  # BL-626 promotion-gate-03
  Scenario: prose acceptance is outside the gate
    Given the candidate's acceptance is prose naming no feature file
    When the coordinator promotes the next eligible ticket
    Then the candidate is promoted
    And no feature file is demanded of it

  # BL-626 promotion-gate-04
  Scenario: a same-prefix sibling feature does not rescue a dangling pointer
    Given the candidate's acceptance names a feature file that does not exist
    And a different feature file sharing the candidate's ticket id prefix
    When the coordinator promotes the next eligible ticket
    Then the promotion is refused
    And the refusal names the missing feature

  # BL-626 promotion-gate-05
  Scenario: the audit enumerates the whole exposure at once
    Given tickets in paused and active whose acceptance resolves to no feature
    When the backfill audit runs
    Then every one of those tickets is listed with the path that failed to resolve
