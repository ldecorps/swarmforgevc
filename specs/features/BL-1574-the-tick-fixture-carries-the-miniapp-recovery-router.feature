Feature: BL-1574 The operator runtime tick fixture carries the miniapp recovery router

  BL-1571 (442bdd1f40, 2026-09-14) routed operator_runtime.bb's miniapp
  watchdog recovery through recover_miniapp_bridge.sh again. The standing
  smoke test test_operator_runtime_tick.sh stubs bounce_bridge_headless.sh
  in its fixture and asserts the stub's marker after a down /lets-talk
  tick, but its fixture never carried the router, so the tick logs
  bounce-failed exit=127 and the marker never appears - and the test's
  completed-cycle check stays green on that failed bounce. This feature is
  that the fixture provides the real router, the stubbed leaf is reached
  through it, and a failed bounce can no longer read as a completed cycle.

  # BL-1574 tick-fixture-miniapp-router-01
  Scenario: the fixture provides the real recovery router
    When the file swarmforge/scripts/test/test_operator_runtime_tick.sh is read
    Then its fixture copies recover_miniapp_bridge.sh from the real scripts directory

  # BL-1574 tick-fixture-miniapp-router-02
  Scenario: the completed-cycle check is not satisfied by a failed bounce
    When the file swarmforge/scripts/test/test_operator_runtime_tick.sh is read
    Then its miniapp-watchdog section asserts the runtime log records bounced and never bounce-failed

  # BL-1574 tick-fixture-miniapp-router-03
  Scenario: the standing smoke test is green on the tree as it stands
    When swarmforge/scripts/test/test_operator_runtime_tick.sh runs
    Then it prints ALL CHECKS PASSED and exits zero

  # BL-1574 tick-fixture-miniapp-router-04
  Scenario Outline: the change is the test alone
    When swarmforge/scripts/<script> on the tree as it stands is compared with main
    Then it is unchanged

    Examples:
      | script                       |
      | operator_runtime.bb          |
      | recover_miniapp_bridge.sh    |
      | bounce_bridge_headless.sh    |
      | rearm_front_desk_bridge.sh   |
