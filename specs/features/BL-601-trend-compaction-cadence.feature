Feature: context-compaction cadence trend exposes per-role context pressure

  # BL-601 (epic BL-594). Compaction frequency is a proxy for context load.
  # Primary signal: GH-22 context-events.jsonl entries with compaction:true
  # (structured telemetry from the BL-664/665 transcript walker — NOT pane
  # spinner strings that change between CLI versions). Derive
  # {role, model, tokens-at-compaction, ts} to compaction telemetry; aggregate
  # compactions/hr and token-at-compaction distribution via trend.ts.
  # Measurement only; pairs with BL-596 rotation cost.

  Background:
    Given context telemetry records compaction from structured invocation events

  # BL-601 compaction-event-emits-01
  Scenario Outline: each detected compaction emits role model tokens and timestamp
    Given role "<role>" on model "<model>" had a context event with compaction true at <ts>
    And that event carried context utilization <util_pct> percent and <input_tokens> input tokens
    When compaction cadence is derived for that event
    Then one compaction record is emitted for role "<role>"
    And the record carries model "<model>" tokens-at-compaction <tokens_at> and timestamp <ts>

    Examples:
      | role  | model           | ts                   | util_pct | input_tokens | tokens_at |
      | coder | claude-sonnet-5 | 2026-08-27T06:00:00Z | 92       | 180000       | 180000    |
      | QA    | gpt-5           | 2026-08-27T07:15:00Z | 88       | 95000        | 95000     |

  # BL-601 aggregator-compactions-per-hour-02
  Scenario: a pure aggregator yields compactions per hour and token-at-compaction distribution
    Given fixture compaction records for multiple roles spanning more than one window
    When the compaction cadence series is aggregated in memory
    Then each window reports compactions per hour per role
    And each window reports the token-at-compaction distribution for that role
    And the aggregation reads no files of its own

  # BL-601 undetectable-role-reads-na-03
  Scenario: a role whose compaction cannot be reliably detected reads NA never a fabricated zero
    Given role "documenter" has no reliable compaction signal in the telemetry stream
    When compaction cadence is queried for that role
    Then the series for that role is marked not applicable
    And zero compactions are not reported

  # BL-601 pane-spinner-not-primary-signal-04
  Scenario: pane spinner text alone does not emit a compaction record
    Given a role pane shows auto-compact or compacting spinner text
    And no structured context event marks compaction true for that role
    When compaction cadence is derived
    Then no compaction record is emitted from the spinner text alone

  # BL-601 trend-ts-series-05
  Scenario: compactions-per-hour per role is plotted through trend.ts
    Given a daily compactions-per-hour series for one role with more than one window
    When the compaction cadence trend is computed
    Then trend.ts reports current prior delta and direction for the series
