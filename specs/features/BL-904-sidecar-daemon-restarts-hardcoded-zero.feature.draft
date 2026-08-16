Feature: The sidecar's daemon restart count is measured, not assumed

  daemonRestarts is a hardcoded zero sitting among four real measurements, so
  a day with hundreds of restarts reports as a confident 0. It must be read
  from the freshness incident log, and must distinguish "no data" from "none".

  Background:
    Given a freshness incident log fixture
    And the cost and health sidecar is emitted from that fixture

  # BL-904 sidecar-daemon-restarts-hardcoded-zero-01
  Scenario: Restarts are counted from the incident log
    Given the log records 155 restart actions and 100 escalate actions
    When the sidecar is emitted
    Then the daemon restart count is 155

  # BL-904 sidecar-daemon-restarts-hardcoded-zero-02
  Scenario: Escalations are not counted as restarts
    Given the log records 0 restart actions and 100 escalate actions
    When the sidecar is emitted
    Then the daemon restart count is 0
    And the count is reported as measured

  # BL-904 sidecar-daemon-restarts-hardcoded-zero-03
  Scenario: The count carries a real trend once history exists
    Given the log spans enough days to establish a trend
    When the sidecar is emitted
    Then the daemon restart series is populated
    And the trend direction is not unknown

  # BL-904 sidecar-daemon-restarts-hardcoded-zero-04
  Scenario Outline: An unavailable log reports no data rather than zero
    Given the incident log is <availability>
    When the sidecar is emitted
    Then the count is reported as unavailable
    And the count is distinguishable from a measured zero

    Examples:
      | availability |
      | missing      |
      | unreadable   |

  # BL-904 sidecar-daemon-restarts-hardcoded-zero-05
  Scenario: A malformed record does not discard the good ones
    Given the log records 3 restart actions followed by a truncated line
    When the sidecar is emitted
    Then the daemon restart count is 3

  # BL-904 sidecar-daemon-restarts-hardcoded-zero-06
  Scenario: Every reliability field is derived rather than literal
    When the sidecar is emitted
    Then no reliability field reports a value that is independent of its source
