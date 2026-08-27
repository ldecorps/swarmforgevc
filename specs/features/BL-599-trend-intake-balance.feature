# mutation-stamp: sha256=4397660dce3dd12a1932b13feeb52925cd708dac6870fc41e01a5b759740dc4c
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-27T06:15:43.303989952Z","feature_name":"intake balance trend compares filed rate to close rate","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-599-trend-intake-balance.feature","background_hash":"33b530ca03c56438869a861722a37804cdf56f67bf99a2f31771668974bde642","implementation_hash":"unknown","scenarios":[{"index":2,"name":"intake balance counts buildable tickets and root intakes but not epic trackers","scenario_hash":"2f17a8f0b3c3f32cf1f20937f2ae53c06f0e279efc843851c99532477316fc49","mutation_count":16,"result":{"Total":16,"Killed":16,"Survived":0,"Errors":0},"tested_at":"2026-08-27T06:14:12.233148643Z"}]}
# acceptance-mutation-manifest-end

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
