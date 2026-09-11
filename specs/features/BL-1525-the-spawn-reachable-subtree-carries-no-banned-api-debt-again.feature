# mutation-stamp: sha256=5244bfec82c6143e4ad5a8fbfd80a808b6c900f5f23915fe895cce70988f91aa
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-11T17:35:43.156990824Z","feature_name":"BL-1525 The spawn-reachable subtree carries no banned-API debt again","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1525-the-spawn-reachable-subtree-carries-no-banned-api-debt-again.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a formerly indebted file names no banned subprocess API","scenario_hash":"80df5dbc06f9bca56910109ba7629c0316ebd27508602958cbd6d973e328609c","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-11T17:35:43.156990824Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1525 The spawn-reachable subtree carries no banned-API debt again

  BL-1022 taught the daemon's closure walk to follow spawn edges and BL-1031
  cleared the subtree it found, retiring the ratchet to the empty set so any
  new direct subprocess call in a spawn-reached file fails loudly. That
  assertion in daemon_cycle_guard_lib_test_runner.bb has been red on main
  since abdf283ece (2026-09-03): ticket_close_guard_lib.bb and
  unregistered_test_gate_lib.bb (loaded by swarm_handoff.bb, which the
  daemon spawns), expedite_cli.bb (spawned by the daemon) and bounded_run_lib.bb
  (loaded by expedite_cli.bb) each name the API. This feature is that the
  three plain waits route through the chokepoint, the second bounded runner
  is folded into it or sanctioned beside it per the human ruling recorded on
  the ticket, and the gate earns its green with every spawn edge intact.
  The runner's other two assertions belong to BL-1524 and BL-1526.

  # BL-1525 spawn-subtree-no-banned-api-debt-01
  Scenario: the gate's spawn-subtree assertion passes with the subtree intact
    When the daemon cycle guard test runner runs on the real swarmforge/scripts tree
    Then its output has no FAIL line naming the spawn-subtree assertion "bl1031: spawn-reachable subtree"
    And the daemon's reachability closure still holds expedite_cli.bb reached by a spawn edge from handoffd.bb
    And the closure still holds ticket_close_guard_lib.bb and unregistered_test_gate_lib.bb reached by a load edge from swarm_handoff.bb

  # BL-1525 spawn-subtree-no-banned-api-debt-02
  Scenario Outline: a formerly indebted file names no banned subprocess API
    When the subprocess-API ban scan runs over <file> alone
    Then it reports zero offenders

    Examples:
      | file                          |
      | ticket_close_guard_lib.bb     |
      | unregistered_test_gate_lib.bb |
      | expedite_cli.bb               |

  # BL-1525 spawn-subtree-no-banned-api-debt-03
  Scenario: a new direct call in the spawn-reachable subtree still fails the gate
    Given a scratch closure whose entrypoint spawns one bb script that calls process/sh directly
    When the spawn-subtree ban scan runs over that scratch closure
    Then that script is reported as an offender

  # BL-1525 spawn-subtree-no-banned-api-debt-04
  Scenario: a converted git call returns at the bound when git never exits
    Given the subprocess wait bound is 300 milliseconds
    And a fake git on PATH that sleeps for 600 seconds
    When ticket-close-guard-lib's git-backed close check is invoked in a scratch repository
    Then the call returns within 5 seconds and reports the check as not satisfied
    And no process of the fake git is still alive
