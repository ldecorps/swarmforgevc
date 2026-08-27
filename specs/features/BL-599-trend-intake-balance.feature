Feature: intake balance trend compares filed rate to close rate

  # BL-599 (epic BL-594). Velocity tracks closes; this adds the intake side and
  # net backlog growth from the same git-history adapter deliveryMetrics already
  # uses — no second reader. Counts buildable ticket arrivals (active/paused),
  # backlog-root INTAKE-*.md, and done/ closes; epic trackers are excluded.
  # Aggregates per-window filed, closed, and net via trend.ts.

  Background:
    Given backlog git history is available through the existing adapter

  # BL-599 filed-closed-net-from-history-01
  Scenario: per-window filed closed and net counts derive from backlog git history
    Given git history where one buildable ticket arrives and one closes in the window
    When intake balance is computed for that history
    Then the window reports one filed ticket
    And the window reports one closed ticket
    And the window net is zero

  # BL-599 pure-aggregator-fixtures-02
  Scenario: a pure aggregator builds the daily filed closed net series without filesystem access
    Given fixture filed and closed event timestamps spanning multiple days
    When intake balance is aggregated in memory
    Then each day reports filed and closed counts and daily net
    And a running net total is available across the series

  # BL-599 counts-intake-docs-not-epics-03
  Scenario Outline: intake balance counts buildable tickets and root intakes but not epic trackers
    Given git history recording <event> for <path>
    When intake balance events are derived
    Then the filed count is <filed>
    And the closed count is <closed>

    Examples:
      | event            | path                                              | filed | closed |
      | ticket arrival   | backlog/active/BL-101-ticket.yaml                 | 1     | 0      |
      | root intake doc  | backlog/INTAKE-20260103-notes.md                  | 1     | 0      |
      | epic tracker     | backlog/paused/BL-594-epic-swarm-behaviour-trends.yaml | 0 | 0      |
      | ticket close     | backlog/done/M8/BL-101-ticket.yaml                | 0     | 1      |

  # BL-599 trend-ts-net-series-04
  Scenario: the net series is plotted through trend.ts
    Given a daily net series with more than one window
    When the net trend is computed
    Then trend.ts reports current prior delta and direction for the net series
