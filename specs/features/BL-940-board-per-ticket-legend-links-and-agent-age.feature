Feature: the pipeline board carries a per-ticket legend line and a time-with-current-agent mark

  # BL-940 (pipeline-board). The residue of BL-670's 2026-07-26 layout
  # addendum after the human's 2026-08-19 ruling sent all layout to BL-585
  # and dropped the mini-slug row. Two of that addendum's directives had
  # nowhere else to land: BL-585's out_of_scope explicitly excludes the
  # LINKS list, and the time-with-current-agent mark renders a value beside
  # the grid mark rather than deriving it. They are gathered here so the
  # human's sentences survive rather than being trimmed away.
  #
  # Telegram renders no links inside a <pre> code block, which is the whole
  # reason the legend is a separate line OUTSIDE it rather than a column in
  # the grid.
  #
  # The gherkin deep-link degrades gracefully: the BL-659 Knowledge
  # Explorer may not exist yet, and the board never waits on it. That
  # degradation is the load-bearing behaviour here, not an edge case —
  # scenario 02 is the reason this ticket can ship before that epic.
  #
  # Step handlers drive the real board renderer. The <explorer state>,
  # <elapsed> and <mark> columns are validated against explicit
  # KNOWN_VALUES, never passed through.

  Background:
    Given a pipeline board rendering a ticket that has its own BL topic

  # BL-940 board-per-ticket-legend-links-and-agent-age-01
  Scenario: the legend line sits outside the code block so its links render
    When the board is rendered
    Then a per-ticket legend line appears outside the code block
    And the legend line links to the ticket's own BL topic

  # BL-940 board-per-ticket-legend-links-and-agent-age-02
  Scenario Outline: the gherkin link degrades rather than blocking the board
    Given the Knowledge Explorer is <explorer state>
    When the board is rendered
    Then the legend line <gherkin link outcome>
    And the board still renders every other section

    Examples:
      | explorer state | gherkin link outcome                     |
      | available      | links to that ticket's gherkin view      |
      | absent         | falls back to the feature file on GitHub |
      | unreachable    | omits the gherkin link                   |

  # BL-940 board-per-ticket-legend-links-and-agent-age-03
  Scenario Outline: the stage mark carries the time with the current agent, to two significant units
    Given the ticket has been with its current agent for <elapsed>
    When the board is rendered
    Then the stage mark reads <mark>

    Examples:
      | elapsed              | mark     |
      | 34 minutes           | X(34m)   |
      | 2 hours 15 minutes   | X(2h15m) |
      | 3 days 4 hours       | X(3d4h)  |

  # BL-940 board-per-ticket-legend-links-and-agent-age-04
  Scenario: wall time is labelled as such until active time is available
    Given active time is not yet available for the ticket
    When the board is rendered
    Then the time with the current agent is shown as wall time
    And it is labelled as wall time rather than presented as active time
