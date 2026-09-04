Feature: BL-1392 A dead cron daemon is never silent

  The swarm schedules its watchdog, its shift boundaries and its reviews
  into the host crontab and checks only that a crontab command exists.
  With no cron daemon running, every install prints success and nothing
  ever fires, and because the watchdog itself rides cron, nothing notices.
  This feature is that an install with no daemon says so and names the
  fix, that the daemon-side sweep notices a stale watchdog heartbeat and
  escalates once per episode, and that nothing here ever starts cron.

  # BL-1392 an-install-with-no-daemon-says-so-01
  Scenario: installing cron lines with no cron daemon running is reported, not celebrated
    Given no cron daemon is running on the host
    When the swarm cron lines are installed
    Then the output carries CRON_DAEMON_DOWN
    And the output names the command that starts cron
    And the install exits non-zero
    And the cron lines are still written

  # BL-1392 an-install-with-a-live-daemon-is-unchanged-02
  Scenario: installing with a live cron daemon behaves as today
    Given a cron daemon is running on the host
    When the swarm cron lines are installed
    Then the output omits CRON_DAEMON_DOWN
    And the install exits zero

  # BL-1392 the-launcher-shows-the-marker-03
  Scenario: a swarm start with no cron daemon shows the marker in its own output
    Given no cron daemon is running on the host
    When the ancillary services are started
    Then the start output carries CRON_DAEMON_DOWN

  # BL-1392 a-stale-watchdog-heartbeat-escalates-once-04
  Scenario: the daemon sweep escalates once when the freshness cron log goes stale
    Given the freshness cron log is older than the heartbeat bound
    When the daemon sweep runs twice
    Then the log carries cron-heartbeat-stale
    And exactly one escalation was sent

  # BL-1392 a-fresh-heartbeat-clears-and-re-arms-05
  Scenario: a fresh heartbeat clears the episode and a later stale one escalates again
    Given the freshness cron log is older than the heartbeat bound
    And the daemon sweep has already escalated once
    When the freshness cron log is refreshed and the sweep runs
    Then the episode is cleared
    And a later stale log escalates again

  # BL-1392 nothing-here-starts-cron-06
  Scenario: neither the installer nor the sweep starts or configures cron
    Given no cron daemon is running on the host
    When the swarm cron lines are installed and the daemon sweep runs
    Then no process attempted to start a cron daemon
    And no host configuration file was written
