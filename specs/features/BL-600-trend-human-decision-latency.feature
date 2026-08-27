Feature: human-decision latency trend separates approval-queue wait from swarm velocity

  # BL-600 (epic BL-594). Some tickets wait on the human, not the swarm.
  # Pair ApprovalRequested ask time (topic outbound ask + ask-message store)
  # with verdict time (human_approval flip / ruling commit). Pure aggregator
  # yields median + outlier decision-latency per gate via trend.ts — same
  # outlier honesty as stageDwell. Measurement only.

  Background:
    Given approval ask and verdict timestamps are knowable from existing stores

  # BL-600 decided-ticket-latency-01
  Scenario Outline: each decided ticket yields one latency from ask to verdict per gate
    Given ticket "<ticket>" had an <gate> ask posted at <ask_ts>
    And the human decided that ticket at <verdict_ts>
    When human decision latency is derived for that ticket
    Then the latency is <latency_ms> milliseconds
    And the record carries gate <gate>

    Examples:
      | ticket  | gate    | ask_ts | verdict_ts | latency_ms |
      | BL-100  | approve | 1000   | 3700000    | 3699000    |
      | BL-200  | amend   | 5000   | 65000      | 60000      |

  # BL-600 median-outlier-aggregator-02
  Scenario: a pure aggregator produces median and outlier decision-latency over a window
    Given fixture decision-latency records spanning more than one window
    And one record is an extreme outlier
    When the decision-latency series is aggregated in memory
    Then each window reports a median decision latency
    And extreme values are listed as outliers separately
    And the aggregation reads no files of its own

  # BL-600 pending-open-age-not-completion-03
  Scenario: a still-pending ask contributes open age and is never counted as decided
    Given ticket "BL-300" has a pending approval ask posted earlier
    And no verdict has been recorded yet
    When human decision latency is derived for that ticket
    Then the ticket contributes an open waiting age
    And it is not included in the decided median or outlier counts

  # BL-600 trend-ts-series-04
  Scenario: the decision-latency series is plotted through trend.ts
    Given a daily median decision-latency series with more than one window
    When the decision-latency trend is computed
    Then trend.ts reports current prior delta and direction for the series
