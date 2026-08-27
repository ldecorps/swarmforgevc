Feature: A freshness alarm names its swarm and why it fired

  heartbeat_age_secs returns the literal 999999999 for three different
  conditions - the log file is missing, the log has no heartbeat line, or the
  newest heartbeat's timestamp will not parse - and that sentinel is
  interpolated straight into the announced text as though it were an age. The
  operator receives "age_secs=999999999", which states neither what is wrong
  nor which swarm it came from.

  Both halves cost real time on 2026-08-21: five alarms arrived over eight
  minutes carrying that sentinel, and because nothing in the text names a
  swarm they could not be attributed to a host at all. The sending checkout
  was still unidentified after a full investigation of the receiving one.

  The checker already resolves its own swarm name - but only inside the
  branch that fills in missing Telegram credentials, so a checkout whose
  credentials are already set in the environment never computes it.

  Background:
    Given a watched daemon "handoffd" with a threshold of 120 seconds

  # BL-1011 freshness-alarm-attribution-01
  Scenario Outline: a violation states which condition fired, never a raw sentinel
    Given the daemon's log <log_state>
    When the freshness check reports a violation
    Then the reported reason is <reason>
    And the reported text contains no sentinel number

    Examples:
      | log_state                   | reason                |
      | is missing entirely         | log-absent            |
      | carries no heartbeat line   | no-heartbeat-line     |
      | carries an unparseable time | unparseable-timestamp |

  # BL-1011 freshness-alarm-attribution-02
  Scenario: a stale but readable heartbeat still reports its real age
    Given the daemon's log carries a heartbeat 300 seconds old
    When the freshness check reports a violation
    Then the reported age is 300 seconds
    And the reported reason is "stale-heartbeat"

  # BL-1011 freshness-alarm-attribution-03
  Scenario Outline: every alarm names the swarm it came from
    Given the checkout's identity names swarm <swarm>
    And the daemon's log is missing entirely
    When the freshness check reports a violation
    Then the reported text names swarm <swarm>

    Examples:
      | swarm   |
      | primary |
      | second  |

  # BL-1011 freshness-alarm-attribution-04
  Scenario: the swarm is named even when credentials are already in the environment
    Given the checkout's identity names swarm "second"
    And Telegram credentials are already set in the environment
    And the daemon's log is missing entirely
    When the freshness check reports a violation
    Then the reported text names swarm "second"

  # BL-1011 freshness-alarm-attribution-05
  Scenario: the durable incident record carries the same swarm and reason
    Given the checkout's identity names swarm "second"
    And the daemon's log is missing entirely
    When the freshness check reports a violation
    Then the incident record names swarm "second"
    And the incident record names the reason "log-absent"
