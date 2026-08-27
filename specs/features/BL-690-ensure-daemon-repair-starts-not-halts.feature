# mutation-stamp: sha256=22902f291837b42610728c2901878e9fb6613dcd05bd721288aa171b5d5359a6
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-27T14:25:38.491021958Z","feature_name":"Ensure repairs the handoff daemon by starting it, never by halting the swarm","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-690-ensure-daemon-repair-starts-not-halts.feature","background_hash":"b04bd980a5d6932616122ec913559cba6503e40240bbb5befd572c80585a707a","implementation_hash":"unknown","scenarios":[{"index":0,"name":"A daemon that is not running is started and reported FIXED","scenario_hash":"be599bba6b68d06af4d9ab7b6c44835b7083f970bdd8f126ea1ab366570db14d","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-27T14:25:38.491021958Z"}]}
# acceptance-mutation-manifest-end

Feature: Ensure repairs the handoff daemon by starting it, never by halting the swarm

  Background:
    Given an ensure fixture project root with two live agent sessions

  # BL-690 ensure-daemon-repair-starts-not-halts-01
  Scenario Outline: A daemon that is not running is started and reported FIXED
    Given the fixture daemon pid file is "<pidState>"
    When ensure runs against the fixture
    Then it reports "daemon: FIXED (restarted the handoff daemon)"
    And the fixture is left with a live handoff daemon

    Examples:
      | pidState        |
      | absent          |
      | stale           |
      | empty           |

  # BL-690 ensure-daemon-repair-starts-not-halts-02
  Scenario: Repairing a dead daemon never halts the swarm it just repaired
    Given the fixture daemon pid file is "stale"
    When ensure runs against the fixture
    Then the two agent sessions are still alive
    And no daemon stop marker was written
    And no swarm halt was recorded

  # BL-690 ensure-daemon-repair-starts-not-halts-03
  Scenario: A healthy daemon is left exactly as it was
    Given the fixture daemon pid file is "live"
    When ensure runs against the fixture
    Then it reports "daemon: OK"
    And the fixture daemon pid is unchanged

  # BL-690 ensure-daemon-repair-starts-not-halts-04
  Scenario: Two consecutive ensure runs leave one live daemon
    Given the fixture daemon pid file is "stale"
    When ensure runs against the fixture
    And ensure runs against the fixture
    Then it reports "daemon: OK"
    And the fixture is left with a live handoff daemon
    And exactly 1 handoff daemon is running for the fixture

  # BL-690 ensure-daemon-repair-starts-not-halts-05
  Scenario: A repair that genuinely cannot start the daemon fails loudly, still without halting
    Given the fixture daemon pid file is "stale"
    And the daemon start path is made to fail
    When ensure runs against the fixture
    Then it reports "daemon: FAILED"
    And ensure exits non-zero
    And the two agent sessions are still alive
    And no swarm halt was recorded

  # BL-690 ensure-daemon-repair-starts-not-halts-06
  Scenario: The daemon repair is exercised through its real command, not a substituted one
    Given no ensure supervisor command override is set
    And the fixture daemon pid file is "stale"
    When ensure runs against the fixture
    Then it reports "daemon: FIXED (restarted the handoff daemon)"
    And the fixture is left with a live handoff daemon
    And the daemon start audit log records a successful start
