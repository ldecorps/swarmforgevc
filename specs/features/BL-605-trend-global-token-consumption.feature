Feature: global token consumption rolls up whole-swarm totals for trend surfaces

  # BL-605 (epic BL-594): One headline series — cumulative tokens and a simple rate
  # for the entire swarm. Per-role burnRate and costTelemetry already exist; this
  # is the global rollup. transcriptUsage is authoritative (populated); llm-cost
  # ledger tokens:null records are not summed. Publishes via trend.ts; mini-app
  # and briefing consumers are BL-603/BL-604.

  Background:
    Given per-role transcript usage records for the swarm

  # BL-605 global-series-cumulative-and-rate-01
  Scenario: a window reports cumulative global tokens and a rate summed across all roles
    Given every role has transcript usage records inside one window
    When global token consumption is aggregated for that window
    Then the series reports the cumulative total tokens across all roles
    And the series reports a rate over the window

  # BL-605 pure-aggregator-fixtures-02
  Scenario: the global aggregator is a pure function over per-role usage fixtures
    Given fixture per-role usage records spanning more than one time bucket
    When the global tokens aggregator runs
    Then each bucket total equals the sum of every role's tokens in that bucket
    And the aggregation reads no files of its own

  # BL-605 missing-buckets-not-silent-zero-03
  Scenario: buckets with missing token data are marked not silently counted as zero
    Given a bucket where some roles have no transcript usage records
    When global token consumption is aggregated
    Then that bucket is marked as having incomplete token data
    And the bucket is not reported as a complete zero total

  # BL-605 transcript-authority-not-null-ledger-04
  Scenario: transcript usage is authoritative over ledger records with null tokens
    Given populated transcript usage totals for every role
    And llm-cost ledger records whose token field is null
    When global token consumption is computed
    Then the global series follows transcript usage totals
    And null ledger token fields are not summed into the global series
