Feature: coordinator activity is surfaced as compact lines on its Telegram topic

  Background:
    Given the Telegram send seam is a stub capturing posted messages
    And the surfacer's durable cursor starts at the beginning of the traces

  # GH-24 coordinator-activity-telegram-feed-01
  Scenario: a coordinator-sent handoff becomes one compact feed line
    Given the coordinator outbox holds a note to "coder" for task "BL-563" newer than the cursor
    When the surfacer tick runs
    Then exactly one line is posted to the coordinator topic naming the type, recipient, and task

  # GH-24 coordinator-activity-telegram-feed-02
  Scenario: a coordinator bookkeeping commit becomes one compact feed line
    Given main holds a coordinator bookkeeping commit closing "BL-608" newer than the cursor
    When the surfacer tick runs
    Then exactly one line is posted to the coordinator topic naming the bookkeeping action and ticket

  # GH-24 coordinator-activity-telegram-feed-03
  Scenario: a tick with no new coordinator activity posts nothing
    Given no coordinator trace is newer than the cursor
    When the surfacer tick runs
    Then nothing is posted to the coordinator topic

  # GH-24 coordinator-activity-telegram-feed-04
  Scenario: already-surfaced activity is not re-posted after a restart
    Given a trace was surfaced on a previous tick and the cursor was persisted
    When the surfacer restarts and the next tick runs
    Then that trace is not posted again

  # GH-24 coordinator-activity-telegram-feed-05
  Scenario: a failed Telegram send is retried on the next tick without duplication
    Given the Telegram send seam fails on the first attempt for a new trace
    When the surfacer tick runs twice
    Then the trace is posted exactly once
    And the cursor only advances past the trace after the successful send
