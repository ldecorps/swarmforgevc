Feature: The freshness watchdog stops manufacturing its own incidents

  The watchdog restarts handoffd whenever its newest heartbeat is older than
  a fixed 120 seconds. That number encodes an assumption about host
  contention which nothing records and nothing rechecks. On 2026-08-21 the
  Mac sat at load average 80 on four cores, a single chase sweep took 17
  seconds, and the watchdog recorded ages of 132, 133, 174, 200, 223, 229,
  291, 343 and 350 seconds against that 120 - killing and restarting a
  daemon that was late, not hung. 694 rotated handoffd.log archives had
  accumulated by 11:11.

  The restart also destroys the evidence the next check reads:
  start_handoff_daemon.sh moves handoffd.log aside on every start, so for a
  window after each restart the log the checker consults is one its own
  restart rotated away.

  Background:
    Given a watched daemon "handoffd" with a base threshold of 120 seconds

  # BL-1012 freshness-self-inflicted-01
  Scenario Outline: a busier host earns a proportionally longer window, up to a ceiling
    Given the host contention factor is <factor>
    When the effective threshold is computed
    Then the effective threshold is <effective> seconds

    Examples:
      | factor | effective |
      | 1      | 120       |
      | 2      | 240       |
      | 4      | 480       |
      | 20     | 600       |
      | unreadable | 120  |

  # BL-1012 freshness-self-inflicted-02
  Scenario: a daemon dead longer than the ceiling is still caught on the busiest host
    Given the host contention factor is 20
    And the daemon's heartbeat is 900 seconds old
    When the freshness check runs
    Then the daemon is restarted

  # BL-1012 freshness-self-inflicted-03
  Scenario Outline: an absent log is a violation only past the post-restart grace window
    Given the watchdog restarted the daemon <elapsed> seconds ago
    And the daemon's log is missing
    When the freshness check runs
    Then the violation outcome is <outcome>

    Examples:
      | elapsed | outcome    |
      | 10      | suppressed |
      | 600     | announced  |

  # BL-1012 freshness-self-inflicted-04
  Scenario: every decision records the threshold and the contention it used
    Given the host contention factor is 4
    And the daemon's heartbeat is 600 seconds old
    When the freshness check runs
    Then the incident record names the effective threshold
    And the incident record names the contention factor
