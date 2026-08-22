Feature: The board surfaces held tickets

  The backlog reader has returned `backlog/hold/` since BL-672, but the
  board's own location union never learned the state exists, so held tickets
  fall off it entirely. Three are invisible today - two parked for twelve
  days, and one severity-high defect parked this morning by a park that was
  itself correct.

  Held tickets are shown in their own section rather than a role column: no
  role holds them, and unlike every other backlog state nothing will ever
  move them on its own, so how long they have been held is the fact that
  matters.

  Background:
    Given a pipeline board rendered from the backlog folders

  # BL-1045 the-board-surfaces-held-tickets-01
  Scenario: a held ticket appears with its id and how long it has been held
    Given a ticket has been held for some time
    When the board is rendered
    Then the held section names that ticket
    And it shows how long the ticket has been held

  # BL-1045 the-board-surfaces-held-tickets-02
  Scenario: a held ticket is never rendered as in-flight
    Given a ticket has been held for some time
    When the board is rendered
    Then no role column names that ticket
    And the not-started column does not name it

  # BL-1045 the-board-surfaces-held-tickets-03
  Scenario: every held ticket is listed, or the board says how many it left out
    Given more held tickets than the held section renders
    When the board is rendered
    Then it states how many held tickets it left out

  # BL-1045 the-board-surfaces-held-tickets-04
  Scenario: an age survives the file being touched
    Given a ticket has been held for some time
    And the ticket's file is written again without being unheld
    When the board is rendered
    Then it still shows the ticket as held for the original duration

  # BL-1045 the-board-surfaces-held-tickets-05
  Scenario: no held tickets renders no held section
    Given no ticket is held
    When the board is rendered
    Then there is no held section
    And the rest of the board is unchanged
