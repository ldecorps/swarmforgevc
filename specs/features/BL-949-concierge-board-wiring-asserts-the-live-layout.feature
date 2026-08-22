# The concierge tick's own board-wiring tests prove something the pipeline
# board module's unit and acceptance suites cannot: that a ticket's backlog
# epic/title and the role that holds it actually REACH the board the tick
# posts. That join is the only thing these scenarios assert. They do not
# re-assert the matrix's own layout - its column padding, caption format and
# ordering are pipelineBoard's contract, gated by BL-585's own suites.
#
# BL-585 rewrote the grid from pivoted per-ticket blocks to a shared matrix
# and updated pipelineBoard.test.js, but two wiring tests in
# conciergeTick.test.js still assert the superseded block layout - a bare
# ticket-number line, a single-space mark row, an epic heading in dashes -
# so they fail on main and have to be triaged out of every later parcel's
# suite run. Re-expressed here as behaviour, they stop rotting the next time
# the layout legitimately changes.
Feature: The board the concierge posts carries each active ticket's backlog context and holding stage

  Background:
    Given the concierge tick renders the pipeline board from the backlog folders and the roles' held tickets

  # BL-949 concierge-board-wiring-01
  Scenario: an active ticket's backlog context reaches the posted board
    Given active ticket "BL-1" carries the epic "Concerto" in the backlog folders
    And the coder holds "BL-1"
    When the concierge tick posts the pipeline board
    Then the posted board carries a caption line for ticket "1" naming its backlog context

  # BL-949 concierge-board-wiring-02
  Scenario: the backlog join is load-bearing, not decoration
    Given active ticket "BL-1" carries neither an epic nor a title in the backlog folders
    And the coder holds "BL-1"
    When the concierge tick posts the pipeline board
    Then the posted board's caption line for ticket "1" names no backlog context

  # BL-949 concierge-board-wiring-03
  Scenario Outline: the stage a ticket sits at reaches the matrix from whoever holds it
    Given active ticket "BL-1" is held by <holder>
    When the concierge tick posts the pipeline board
    Then ticket "1" is marked on the "<row>" row of the matrix
    And every other stage row leaves ticket "1" unmarked

    Examples:
      | holder    | row |
      | no role   | NS  |
      | the coder | CO  |
      | QA        | QA  |
