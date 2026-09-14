Feature: BL-1571 The miniapp watchdog recovers through recover_miniapp_bridge

  BL-1159 (43da3844ec, 2026-08-26) routed operator_runtime.bb's miniapp
  watchdog recovery through recover_miniapp_bridge.sh, which re-arms the
  front desk when it owns the stack and only otherwise bounces the headless
  bridge. BL-653's landing the same day put bounce_bridge_headless.sh back
  and removed the def, so the routing has been gone from main since, and
  the shell test that pins it has been red. This feature is that the
  watchdog's recovery reaches the re-arm router again.

  # BL-1571 miniapp-watchdog-recover-01
  Scenario: the watchdog's recovery invokes the re-arm router
    When the file swarmforge/scripts/operator_runtime.bb is read
    Then its miniapp recovery invokes recover_miniapp_bridge.sh
    And its miniapp recovery does not invoke bounce_bridge_headless.sh

  # BL-1571 miniapp-watchdog-recover-02
  Scenario: the shell test that pins the routing is green on the tree as it stands
    When swarmforge/scripts/test/test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh runs
    Then it prints ALL CHECKS PASSED and exits zero

  # BL-1571 miniapp-watchdog-recover-03
  Scenario Outline: the change is the routing alone
    When swarmforge/scripts/<script> on the tree as it stands is compared with main
    Then it is unchanged

    Examples:
      | script                       |
      | recover_miniapp_bridge.sh    |
      | rearm_front_desk_bridge.sh   |
      | bounce_bridge_headless.sh    |
      | stop_bridge_headless.sh      |
