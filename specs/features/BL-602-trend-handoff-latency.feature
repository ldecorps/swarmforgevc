Feature: handoff latency trend makes parcel queue wait visible per recipient role

  # BL-602 (epic BL-594). Handoffs already carry enqueued_at on send and
  # dequeued_at when ready_for_next claims them. Read completed and in-flight
  # parcels from master and worktree mailboxes; aggregate median + outlier
  # latency per recipient via trend.ts — same outlier honesty as stageDwell.
  # Pairs with BL-596 stranding on mono-router. Measurement only.

  Background:
    Given handoff files carry enqueued_at and dequeued_at timestamps

  # BL-602 processed-handoff-latency-01
  Scenario Outline: each processed handoff yields latency from enqueue to dequeue per recipient
    Given a handoff for recipient "<role>" enqueued at <enqueued_ts>
    And that handoff was dequeued at <dequeued_ts>
    When handoff latency is derived for that parcel
    Then the latency is <latency_ms> milliseconds
    And the record carries recipient "<role>"

    Examples:
      | role      | enqueued_ts | dequeued_ts | latency_ms |
      | coder     | 1000        | 61000       | 60000      |
      | cleaner   | 5000        | 905000      | 900000     |

  # BL-602 median-outlier-per-role-02
  Scenario: a pure aggregator produces median and outlier latency per role over a window
    Given fixture handoff-latency records for multiple roles spanning more than one window
    And one record is an extreme outlier for its role
    When the handoff-latency series is aggregated in memory
    Then each window reports a median latency per recipient role
    And extreme values are listed as outliers separately per role
    And the aggregation reads no files of its own

  # BL-602 queued-open-wait-not-completion-03
  Scenario: a still-queued handoff contributes open wait and is never counted as processed
    Given a handoff sitting in a recipient inbox with enqueued_at but no dequeued_at
    When handoff latency is derived for that parcel
    Then the parcel contributes an open waiting age
    And it is not included in the processed median or outlier counts

  # BL-602 worktree-mailboxes-covered-04
  Scenario Outline: handoff latency reads master and worktree mailboxes not master alone
    Given a processed handoff in <mailbox>
    When handoff latency records are gathered
    Then that handoff contributes to the latency series

    Examples:
      | mailbox                              |
      | master coder inbox/completed         |
      | worktree cleaner inbox/completed     |
      | worktree QA inbox/in_process         |

  # BL-602 trend-ts-series-05
  Scenario: the per-role median handoff-latency series is plotted through trend.ts
    Given a daily median handoff-latency series for one role with more than one window
    When the handoff-latency trend is computed
    Then trend.ts reports current prior delta and direction for the series
