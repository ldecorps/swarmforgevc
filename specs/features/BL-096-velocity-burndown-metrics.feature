Feature: delivery metrics derived from repo history and charted

# BL-096 metrics-01
Scenario: velocity series matches git-recorded closes
  Given a repo whose history contains tickets closed into done/ on known
    dates
  When the velocity series is computed
  Then each time bucket's count equals the closes git records for it
  And recomputing on the same history yields the identical series

# BL-096 metrics-02
Scenario: burndown reconstructs a milestone's past
  Given a milestone whose tickets were specced and closed across history
  When its burndown series is computed
  Then each point equals that date's remaining open-ticket count for the
    milestone
  And the final point matches the current backlog folder state

# BL-096 metrics-03
Scenario: cycle time per closed ticket
  Given a ticket specced at one commit date and closed at a later one
  When cycle-time metrics are computed
  Then that ticket contributes the spec-to-close duration
  And the reported median/percentiles reflect the recent closed set

# BL-096 metrics-04
Scenario: charts render from the endpoint
  Given the bridge is running and the web UI is open
  When the metrics section loads
  Then a burndown chart per milestone and a velocity chart render from
    the endpoint's JSON
  And the endpoint rejects requests without the bearer token

# BL-096 metrics-08
Scenario: every open ticket and milestone carries a forecast
  Given historical closes and a current open queue with dependencies
  When forecasts are computed
  Then each open ticket reports p50 and p85 estimated delivery dates
  And no ticket's dates precede those of its depends_on tickets
  And each milestone reports the dates of its last-forecast ticket

# BL-096 metrics-06
Scenario: every metric carries a trend
  Given at least two windows of history exist for a metric
  When the metrics surface is queried
  Then each metric reports its series, current-window value, and the
    delta and direction versus the prior window

# BL-096 metrics-07
Scenario: suite-duration trend from local records
  Given an extension/.test-durations.jsonl with runs across several days
  When the metrics surface is queried locally
  Then a test-suite duration series and trend are reported
  And a machine without the file reports "no local data" without error

# BL-096 metrics-05
Scenario: no new bookkeeping state
  When metrics are computed twice with no intervening git changes
  Then no file in the repo or .swarmforge/ was created or modified by
    the computation

# Non-behavioral gates:
#  - All derivations pure functions over a provided history/event list;
#    git-log parsing isolated behind a thin tested adapter (fake history
#    in unit tests, no live git required).
#  - BL-071 metrics-module suite and BL-065 bridge suite stay green.
