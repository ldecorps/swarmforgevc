Feature: BL-1413 The freshness check measures a heartbeat log from its newest heartbeat line, whatever bytes the file carries

  daemon_log_freshness_check.sh (BL-675) runs from cron every two minutes and
  measures each watched daemon's age as NOW minus the timestamp of the last
  "heartbeat" line in its log. It finds that line with GNU grep, which stops
  printing lines at the first NUL byte it meets and reports "binary file
  matches" instead. Around 2026-08-30 every supervisor log gained one
  NUL-filled line (the crash that also killed cron), so from the moment cron
  came back on 2026-09-05T04:00Z the check read the last heartbeat BEFORE
  that byte, six days old, on five healthy, live-heartbeating supervisors.
  It restarted handoffd and four supervisors on every cool-off window and
  announced FRESHNESS_VIOLATION to the Operator topic on every tick: 72
  restarts and 136 escalations in the first 90 minutes.

  This feature is that the age is measured from the newest heartbeat line
  in the file, regardless of any byte the file contains, so a healthy daemon
  is never restarted or announced for a corrupt line in its past, and a
  genuinely stale daemon still is.

  Background:
    Given a watched daemon whose log carries heartbeat lines from a fixture clock

  # BL-1413 a-nul-byte-in-the-past-is-not-staleness-01
  Scenario: a NUL-filled line older than the newest heartbeat does not change the measured age
    Given the log holds old heartbeat lines, then one NUL-filled line, then a heartbeat 10 seconds ago
    When the freshness check runs
    Then the daemon's measured age is 10 seconds
    And no restart is performed and nothing is announced

  # BL-1413 a-nul-byte-after-the-last-heartbeat-measures-that-heartbeat-02
  Scenario: a NUL-filled line with no heartbeat after it leaves the age at the last real heartbeat
    Given the log holds a heartbeat 20 seconds ago followed by one NUL-filled line
    When the freshness check runs
    Then the daemon's measured age is 20 seconds
    And no restart is performed and nothing is announced

  # BL-1413 a-genuinely-stale-log-still-fires-03
  Scenario: a log whose newest heartbeat is past the threshold still restarts and announces
    Given the log holds a heartbeat older than the daemon's threshold and a NUL-filled line before it
    When the freshness check runs
    Then the daemon is restarted and a FRESHNESS_VIOLATION restart is announced naming its real age

  # BL-1413 the-live-supervisor-logs-are-healthy-04
  Scenario: the check over the real supervisor logs of 2026-09-05 reports every supervisor fresh
    Given the five supervisor logs as they stood on 2026-09-05, each with its NUL-filled line
    When the freshness check runs with restart and announce stubbed
    Then every supervisor's measured age is under its threshold
    And neither stub is invoked
