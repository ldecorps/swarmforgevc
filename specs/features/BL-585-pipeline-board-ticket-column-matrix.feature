Feature: The pipeline board renders active tickets as one matrix with ticket columns

  This slice replaced BL-455's repeat-per-ticket shape - a full eight-line stage block
  per active ticket under a "-- epic --" heading, 8N lines to carry N marks - with ONE
  shared matrix, and that consolidation is what survives.

  Its particular AXIS did not. BL-585 made role rows shared and ticket numbers the
  column headers, so an extra ticket widened the board; BL-979 pivoted that on
  2026-08-20, because Telegram's <pre> does not wrap and width is the scarce axis on a
  phone while vertical growth is cheap. Tickets are rows now and the eight stages are
  the shared columns, so the dropping axis is height rather than width. The scenarios
  that pinned the ticket-column layout and its width-based dropper have been retired
  rather than reworded - restating them for the new axis would just duplicate BL-979's
  own feature file, which is where that contract lives.

  What remains here is what BL-979's file does NOT re-assert: how each holder maps onto
  a stage mark (including a coordinator-held ticket rendering at QA), that a ticket
  dropped by the budget is still reachable in the link list below the board, that the
  padding survives Telegram's whitespace handling, and that the phone grid-only render
  and the full board body carry the same matrix.

  Background:
    Given the pipeline board grid width budget is 30 characters

  # BL-585 pipeline-board-ticket-columns-02
  Scenario Outline: a ticket's mark sits under the stage column of the role holding it
    Given active ticket BL-537 is held by <holder>
    When the pipeline board grid is rendered
    Then stage column "<stage>" carries the mark "X" in the BL-537 row
    And every other stage column carries "." in the BL-537 row

    Examples:
      | holder      | stage |
      | coder       | CO    |
      | QA          | QA    |
      | coordinator | QA    |
      | nobody      | NS    |

  # BL-585 pipeline-board-ticket-columns-05
  Scenario: a ticket dropped by the row budget stays reachable in the link list
    Given 15 active tickets and a resolvable repo base url
    When the full pipeline board is rendered
    Then all 15 ticket ids appear in the link list

  # BL-585 pipeline-board-ticket-columns-06
  Scenario: an empty board renders a plain placeholder with no epic decoration
    Given no active tickets
    When the pipeline board grid is rendered
    Then the grid is the single line "(no active tickets)"

  # BL-585 pipeline-board-ticket-columns-07
  Scenario: matrix padding survives Telegram's whitespace handling inside a pre block
    Given active ticket BL-537 held by coder and active ticket BL-576 held by QA
    When the pipeline board grid is rendered
    Then every column gap in the matrix is a non-breaking space
    And no matrix line contains a plain ASCII space

  # BL-585 pipeline-board-ticket-columns-08
  Scenario: the phone grid-only render and the Telegram board body carry the same matrix
    Given active ticket BL-537 held by coder and active ticket BL-576 held by QA
    When the grid-only render and the full board body are both produced
    Then the grid-only render is a prefix of the full board body
