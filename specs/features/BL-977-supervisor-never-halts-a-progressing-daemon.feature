Feature: BL-977 the supervisor never halts a daemon that is demonstrably progressing

  On 2026-08-20T07:55:35Z handoffd_supervisor.bb's evaluate-health returned
  :stalled and alarm-and-halt! killed every agent tmux session. The daemon was
  not wedged: it had written heartbeat "cycle=410-start" at 07:54:33.336Z and
  then logged six further sweep-boundary lines, the last at 07:55:08.877Z -
  26s before the halt. What crossed the 30s SUPERVISOR_STALL_MS window was the
  heartbeat FILE's mtime (61803 ms), because BL-789 writes it only at the start
  and end of a poll cycle while a single heavy sweep (dropped-parcel-sweep,
  measured at 143269 ms that morning) runs uninterrupted between the two. The
  daemon's own in-flight sweep is tracked in memory only
  (daemon_cycle_guard_lib/current-context), so the supervisor cannot see it.

  Background:
    Given a supervisor whose stall threshold "SUPERVISOR_STALL_MS" is 30000 ms
    And pending outbox mail older than the stall threshold
    And the tracked daemon process is alive

  # BL-977 supervisor-never-halts-a-progressing-daemon-01
  Scenario Outline: the health verdict reads progress, not heartbeat mtime alone
    Given the heartbeat file is <heartbeat_age_ms> ms old
    And the in-flight sweep marker state is "<marker>"
    When the supervisor evaluates health
    Then the verdict is "<verdict>"

    Examples:
      | heartbeat_age_ms | marker         | verdict |
      | 61803            | sweep-87000ms  | healthy |
      | 45000            | sweep-31000ms  | healthy |
      | 240000           | sweep-235000ms | stalled |
      | 61803            | idle           | stalled |
      | 61803            | absent         | stalled |
      | 1200             | absent         | healthy |

  # BL-977 supervisor-never-halts-a-progressing-daemon-02
  Scenario: a dead process is still dead however fresh the marker
    Given the tracked daemon process is gone
    And the in-flight sweep marker state is "sweep-1000ms"
    When the supervisor evaluates health
    Then the verdict is "dead"

  # BL-977 supervisor-never-halts-a-progressing-daemon-03
  Scenario: the 2026-08-20 halt does not reproduce
    Given the observations measured at 2026-08-20T07:55:35Z
    When the supervisor evaluates health
    Then the verdict is "healthy"
    And the swarm halt is never invoked

  # BL-977 supervisor-never-halts-a-progressing-daemon-04
  Scenario: the daemon publishes the sweep it is inside, and clears it when the sweep ends
    Given a daemon poll cycle that runs a sweep named "dropped-parcel-sweep"
    When the sweep is running
    Then the in-flight sweep marker names "dropped-parcel-sweep" with its start instant
    When that sweep returns
    Then the in-flight sweep marker state is "idle"

  # BL-977 supervisor-never-halts-a-progressing-daemon-05
  Scenario: a wedged poll loop is still caught within the in-sweep budget
    Given a daemon whose poll loop has stopped advancing while its process remains alive
    When the supervisor evaluates health repeatedly past the in-sweep budget
    Then the verdict becomes "stalled"
    And the swarm halt is invoked once
