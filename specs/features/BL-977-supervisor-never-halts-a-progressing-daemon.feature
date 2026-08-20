# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-20T13:08:30.541145Z","feature_name":"BL-977 the supervisor never halts a daemon that is demonstrably progressing","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-977-supervisor-never-halts-a-progressing-daemon.feature","background_hash":"3061f32091483987ed6f66d343044faf3888f221b27c45178089dae6d764f30b","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

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
  # Hardener note (2026-08-20, BL-234): mutating <heartbeat_age_ms> by a few
  # ms on every row (1,2,3,4,5,6) is an accepted equivalent mutant, not a
  # coverage gap - evaluate-health (handoffd_supervisor.bb) never compares
  # the raw value against anything close to it:
  #   - rows 1-2 (sweep-87000ms/sweep-31000ms, both under-budget): under-
  #     budget? short-circuits to :healthy before effective-heartbeat-age-ms
  #     is ever computed - the heartbeat value is dead data on this path.
  #   - row 3 (sweep-235000ms, over-budget): in-flight-but-over-budget forces
  #     effective-heartbeat-age-ms to nil regardless of the real value, so
  #     the :stalled verdict comes from (nil? effective-heartbeat-age-ms),
  #     never from comparing 240000 vs 239991.
  #   - rows 4-6 (marker idle/absent, so not in-flight): the value IS read
  #     and compared against stall-ms=30000, but a several-ms shift keeps
  #     61803/61804/61798 on the stalled side and 1200/1193 on the healthy
  #     side - neither mutant crosses the boundary the decision actually
  #     branches on.
  # Row 4's own heartbeat_age_ms mutant (61803->61804) initially reported
  # KILLED, but its own subtest ("[4]") PASSED - the mutant run's failure
  # was subtest 9 ("the daemon publishes the sweep it is inside"), an
  # UNRELATED flake: install-sweep-marker-writer!'s spit
  # (daemon_cycle_guard_lib.bb) is not atomic, and the acceptance step
  # that waited for the marker file only checked existsSync, not
  # parseable content - under host load (42-45/4 cores) it could read a
  # torn write and throw "Unexpected end of JSON input". Fixed at the
  # source in bl977SupervisorProgressSteps.js's "the sweep is running"
  # step (waits for parseable content, not just existence) rather than
  # accepted as one more equivalent - a false kill is not evidence either
  # way and must not be misread as coverage. The marker-column and
  # verdict-column mutants on every row killed clean on their own
  # subtests, proving the marker (not the heartbeat digits) is what this
  # outline actually pins.
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
