Feature: Seat identity never escapes the mailbox layer on the observation path

  BL-983 declared that seat identity never escapes the mailbox layer, then
  enforced it only where a seat FORWARDS work. Where the board READS who
  holds what, the seat id survives: the stage map records `coder@sonnet2`,
  the held-role reading groups by that key, and the renderer - which knows
  only bare stage names - matches nothing and paints the ticket as
  not-started while the seat is actively working it.

  A seat key folds onto its stage on the read path too. A multi-seat stage
  stays one column and one precedence position, and a stage map written
  before the fix still reads correctly, because that map is a file on disk
  that outlives the process which wrote it.

  Background:
    Given a pipeline stage configured with a bare seat and a second seat

  # BL-1040 seat-identity-never-escapes-on-the-observation-path-01
  Scenario: a ticket held by the second seat is reported under its stage
    Given the second seat holds a ticket in its mailbox
    When the stage map is computed
    Then the ticket is recorded under the stage
    And the stage map carries no seat id

  # BL-1040 seat-identity-never-escapes-on-the-observation-path-02
  Scenario Outline: a ticket held by any seat of the stage is never painted as not-started
    Given <holder> holds a ticket in its mailbox
    When the board is rendered
    Then that ticket is shown as held by the stage
    And it is not shown as not-started

    Examples:
      | holder          |
      | the bare seat   |
      | the second seat |

  # BL-1040 seat-identity-never-escapes-on-the-observation-path-03
  Scenario: two seats holding two tickets share one column
    Given each seat holds its own ticket in its mailbox
    When the board is rendered
    Then both tickets are shown under the one stage
    And the board has exactly one column for that stage

  # BL-1040 seat-identity-never-escapes-on-the-observation-path-04
  Scenario: a multi-seat stage takes one position in the precedence order
    When the stage map is computed
    Then the stage appears exactly once in the stage precedence order

  # BL-1040 seat-identity-never-escapes-on-the-observation-path-05
  Scenario: a stage map recorded by an older producer still reads correctly
    Given a stage map recorded earlier that records a ticket under a seat id
    When the board is rendered
    Then that ticket is shown as held by the stage
    And it is not shown as not-started
