Feature: One briefing send walks the backlog's history once, and every section reads the same snapshot

  Background:
    Given a briefing send whose sections include the open-ticket chart, the cost-health sidecar and the digest line

  # BL-897 briefing-gather-once-01
  Scenario: the send walks backlog history once regardless of how many sections need it
    Given three sections of the send each need ticket lifecycle data
    When the briefing send runs
    Then the backlog's history is walked exactly once
    And every section that needed lifecycle data received it

  # BL-897 briefing-gather-once-02
  Scenario: every section of one send reports the same ticket state
    Given a ticket that closes while the briefing send is in progress
    When the briefing send runs
    Then every section of the sent email reports that ticket in the same state

  # BL-897 briefing-gather-once-03
  Scenario Outline: a section falls back to its own walk when the shared snapshot is unusable
    Given the shared lifecycle snapshot is <snapshot>
    When a section that needs lifecycle data runs
    Then the section renders its content
    And the briefing is sent

    Examples:
      | snapshot     |
      | missing      |
      | unreadable   |
      | from a prior day |

  # BL-897 briefing-gather-once-04
  Scenario: a consumer run outside a briefing send still works on its own
    Given the open-ticket chart tool is run directly with no shared snapshot offered
    When the tool runs
    Then it derives the lifecycle data itself and renders the chart

  # BL-897 briefing-gather-once-05
  Scenario: the shared snapshot is never committed to the repository
    Given a briefing send has written a shared lifecycle snapshot
    When the repository's tracked files are inspected
    Then the snapshot is not among them
