Feature: BL-785 freshness checker honours a deliberate stop
  The freshness checker restarts a watched daemon if and only if that daemon's
  stop was NOT deliberate: a crash or freeze is always killed and restarted
  exactly as BL-675 built it, while a stop the operator or the swarm itself
  asked for stays stopped. The deliberate-stop verdict is reached from durable
  state alone — no live process is consulted.

  Background:
    Given a fixture swarm root with handoffd and babysitterd watched by the freshness checker
    And the daemons' start scripts and binaries are stubbed on PATH

  # BL-785 freshness-deliberate-stop-01
  Scenario: a full-stack stop suppresses both restarts
    Given the fixture swarm was stopped by the full-stack stop path
    And both watched daemons' heartbeat logs are stale
    When the freshness checker runs
    Then neither watched daemon is restarted
    And no watched daemon process is running afterwards

  # BL-785 freshness-deliberate-stop-02
  Scenario: a pipeline-only stop suppresses only the daemons it stopped
    Given the fixture swarm was stopped by the pipeline-only stop path
    And handoffd's heartbeat log is stale
    And babysitterd was left running and its heartbeat log then goes stale
    When the freshness checker runs
    Then handoffd is not restarted
    And babysitterd is killed and restarted by that same run

  # BL-785 freshness-deliberate-stop-03
  Scenario: with no stop requested, a stale daemon is restarted exactly as before
    Given no deliberate stop has been requested
    And a watched daemon's heartbeat log is stale
    When the freshness checker runs
    Then the daemon is killed via its pid file and restarted via its own start script
    And the incident record is appended before the announce
    And the announce carries the existing FRESHNESS_VIOLATION text

  # BL-785 freshness-deliberate-stop-04
  Scenario Outline: starting a daemon again re-arms watching for it
    Given the fixture swarm was stopped by the full-stack stop path
    And <daemon>'s start script has been run again
    And <daemon>'s heartbeat log is stale
    When the freshness checker runs
    Then <daemon> is killed and restarted

    Examples:
      | daemon      |
      | handoffd    |
      | babysitterd |

  # BL-785 freshness-deliberate-stop-05
  Scenario: the deliberate-stop verdict is reached with no swarm process alive
    Given the fixture root's durable state records a deliberate stop of both watched daemons
    And no handoffd, babysitterd, bb, or node process is running
    When the freshness checker runs
    Then neither watched daemon is restarted
    And the checker exits successfully

  # BL-785 freshness-deliberate-stop-06
  Scenario Outline: repeated or empty stops behave like one stop of a running swarm
    Given <stop-history>
    And both watched daemons' heartbeat logs are stale
    When the freshness checker runs
    Then neither watched daemon is restarted

    Examples:
      | stop-history                                              |
      | the full-stack stop path was run twice in a row           |
      | the full-stack stop path was run when nothing was running |
