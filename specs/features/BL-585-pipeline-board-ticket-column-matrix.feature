Feature: The pipeline board renders active tickets as one matrix with ticket columns

  The pinned Telegram pipeline board currently emits a full eight-line stage block for
  every active ticket, grouped under a "-- epic --" section heading. With N active
  tickets that is 8N lines to carry N marks, and the epic heading is what forces the
  repeat-per-group shape in the first place.

  The board becomes ONE matrix instead: role rows shared across every ticket, ticket
  numbers as column headers, so an extra ticket adds a column rather than another
  block. The epic stops being a section heading and becomes a short caption line under
  the matrix, one per visible ticket column.

  Growing sideways has the opposite failure mode to growing downwards, and Telegram's
  <pre> does not wrap: past a certain width the grid needs horizontal scrolling on a
  phone, which is exactly what the narrow-grid work protected. So the matrix carries an
  explicit character-width budget and drops columns past it, announcing what it dropped
  rather than truncating silently. A dropped ticket is still reachable in the link list
  below the board, so the cap costs reach, never information.

  Background:
    Given the pipeline board grid width budget is 30 characters

  # BL-585 pipeline-board-ticket-columns-01
  Scenario: roles are rows and active tickets are columns
    Given active ticket BL-537 held by coder and active ticket BL-576 held by QA
    When the pipeline board grid is rendered
    Then the matrix opens with one header row carrying "537" and "576"
    And the matrix has exactly 8 role rows labelled NS, SP, CO, CL, AR, HD, DC and QA
    And no epic section heading appears anywhere in the grid

  # BL-585 pipeline-board-ticket-columns-02
  Scenario Outline: a ticket's mark sits in its own column on the row of the role holding it
    Given active ticket BL-537 is held by <holder>
    When the pipeline board grid is rendered
    Then role row "<row>" carries the mark "X" in the BL-537 column
    And every other role row carries "." in the BL-537 column

    Examples:
      | holder      | row |
      | coder       | CO  |
      | QA          | QA  |
      | coordinator | QA  |
      | nobody      | NS  |

  # BL-585 pipeline-board-ticket-columns-03
  Scenario Outline: the epic prints as a per-ticket caption under the matrix
    Given active ticket BL-537 whose epic is <epic>
    When the pipeline board grid is rendered
    Then the caption line "<caption>" appears below the matrix

    Examples:
      | epic              | caption               |
      | swarm-reliability | 537 swarm-reliability |
      | absent            | 537 (no epic)         |

  # BL-585 pipeline-board-ticket-columns-04
  Scenario Outline: the matrix stays inside the width budget and names what it dropped
    Given <active_count> active tickets whose display ids are 3 characters wide
    When the pipeline board grid is rendered
    Then no grid line is wider than 30 characters
    And the matrix shows <shown> ticket columns
    And the grid overflow line is "<overflow>"

    Examples:
      | active_count | shown | overflow       |
      | 3            | 3     | (none)         |
      | 7            | 7     | (none)         |
      | 10           | 7     | +3 more active |

  # BL-585 pipeline-board-ticket-columns-05
  Scenario: a ticket dropped by the width budget stays reachable in the link list
    Given 10 active tickets and a resolvable repo base url
    When the full pipeline board is rendered
    Then all 10 ticket ids appear in the link list

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
