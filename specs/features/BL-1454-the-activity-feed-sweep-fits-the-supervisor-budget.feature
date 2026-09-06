Feature: BL-1454 The coordinator activity-feed sweep fits inside the supervisor's budget

  GH-24 gave handoffd a coordinator-activity-feed-sweep that derives compact
  Telegram lines from the coordinator's durable traces. With no cursor file
  its first tick selects every sent handoff (6463 on 2026-09-06) plus the
  500-commit git log window, posts them one subprocess at a time with no cap
  and no deadline, and writes the cursor only when the loop ends. The loop
  never ends: the tick overruns SUPERVISOR_IN_SWEEP_BUDGET_MS, the supervisor
  rules the daemon stalled, and BL-144's halt kills every role tmux session
  every ~5 minutes, with the cursor still unwritten so the next cycle
  replays from item 0. This feature is that a first tick seeds at the newest
  trace and posts nothing historical, a tick posts at most a capped batch
  and stops at its own deadline, the cursor is persisted after every
  successful post, and the remainder follows on later ticks in order with
  no duplicates.

  Background:
    Given the feed's Telegram send, cursor store and clock are injected seams and no live Telegram is reached

  # BL-1454 first-tick-seeds-at-newest-and-posts-nothing-historical-01
  Scenario: the first tick seeds its cursors at the newest traces and posts nothing
    Given no cursor file exists
    And the coordinator's sent mailbox holds 6463 handoffs and main holds 500 bookkeeping commits
    When the activity-feed tick runs
    Then no line is posted
    And the cursor file names the newest sent handoff and the newest bookkeeping commit
    And a following tick after one new sent handoff posts exactly that one line

  # BL-1454 a-tick-posts-at-most-its-cap-and-carries-the-rest-02
  Scenario: a tick posts at most its cap and later ticks carry the remainder in order
    Given the cursor names a trace with 50 newer traces behind it
    And the per-tick post cap is 20
    When the activity-feed tick runs twice
    Then the first tick posts exactly 20 lines, in trace order
    And the cursor file names the 20th newer trace after the first tick
    And the second tick posts the next 20 traces and none is repeated

  # BL-1454 the-cursor-is-persisted-after-every-successful-post-03
  Scenario: an interrupted tick loses no post and re-posts nothing on restart
    Given the cursor names a trace with 50 newer traces behind it
    And the send seam succeeds three times and then interrupts the tick
    When the activity-feed tick runs
    Then the cursor store received a write after the first, the second and the third post
    And the cursor file names the 3rd newer trace
    And a restarted tick posts the 4th newer trace first

  # BL-1454 a-tick-stops-at-its-own-deadline-04
  Scenario: a tick stops at its deadline and leaves the rest for the next tick
    Given the cursor names a trace with 50 newer traces behind it
    And the clock advances 10 seconds per post
    And the tick deadline is 30 seconds
    When the activity-feed tick runs
    Then at most 3 lines are posted
    And the tick returns before the clock passes the deadline
    And the unposted traces are posted by later ticks in order
