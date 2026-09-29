Feature: BL-1818 The pipeline board's grid cell shows how long the seat has held the ticket
  Each active ticket's row marked its current stage with a fixed X, which
  says where a ticket is but not how long it has been stuck there. The
  occupied cell now shows the time since the ticket's parcel reached that
  stage, in the coarsest unit (minutes, then hours, then days), read from
  the stage map's own as-of (the parcel's enqueued time). A held ticket
  with no recorded arrival keeps its X. The cell grows to three characters
  by absorbing the one-space separator between cells, so the header reads
  as before and every line stays within the 30-character phone budget.
  The board's minute-level dwell refreshes by editing the posted message
  in place, while a stage change still reposts it.

  Background:
    Given an active ticket BL-537 held at stage "QA"

  # BL-1818 cell-shows-coarse-dwell-01
  Scenario Outline: the held cell reads <mark> when the parcel reached the stage <age> ago
    Given its parcel reached "QA" <age> ago
    When the board grid renders
    Then the "QA" cell in the BL-537 row reads "<mark>"
    And every other stage cell in that row reads "."

    Examples:
      | age        | mark |
      | 45 seconds | 0m   |
      | 45 minutes | 45m  |
      | 12 hours   | 12h  |
      | 3 days     | 3d   |

  # BL-1818 no-recorded-arrival-keeps-x-02
  Scenario: a held ticket with no recorded arrival keeps its X
    Given its stage map entry records no arrival time
    When the board grid renders
    Then the "QA" cell in the BL-537 row reads "X"

  # BL-1818 header-and-width-hold-03
  Scenario: the header is unchanged and the widest line stays within the phone budget
    Given its parcel reached "QA" 45 minutes ago
    And every active ticket's display id is 5 characters wide
    When the board grid renders
    Then the header row lists the stage glyphs "NS SP CO CL AR HD DC QA" left to right
    And the widest grid line is at most 30 characters

  # BL-1818 dwell-only-change-edits-in-place-04
  Scenario Outline: a tick whose only change is <change> <action> the posted board
    Given the board was posted when its parcel had been at "QA" for 45 minutes
    And the next tick finds <change>
    When the board syncs
    Then it <action> the posted board message

    Examples:
      | change                           | action           |
      | the dwell advanced to 46 minutes | edits in place   |
      | BL-537 moved to stage "DC"       | deletes and reposts |
      | nothing changed                  | leaves untouched |
