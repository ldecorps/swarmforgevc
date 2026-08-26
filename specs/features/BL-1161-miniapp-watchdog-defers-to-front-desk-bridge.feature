Feature: operator_runtime miniapp watchdog must not SIGTERM-kill a front-desk-owned bridge

  # BL-1161: start_bridge_headless defers to front_desk_supervisor when its pid
  # file is alive (BL-1158 partial), but operator_runtime's miniapp-watchdog still
  # calls bounce_bridge_headless → stop_bridge_headless, which pgrep-kills every
  # start-bridge-headless.js for this root with no front-desk check. Live 2026-08-26:
  # bridge received SIGTERM ~7s after bind while operator_runtime stayed up;
  # OPERATOR_MINIAPP_WATCHDOG_ENABLED=0 was the ops hotfix.

  Background:
    Given a fixture swarm root with front-desk-supervisor owning the bridge on port 8765
    And operator_runtime miniapp watchdog is enabled for that root

  # BL-1161 watchdog-no-stop-bridge-when-front-desk-01
  Scenario: miniapp watchdog recovery does not invoke stop_bridge_headless when front desk owns the stack
    Given front-desk-supervisor.pid is alive for the fixture root
    And lets-talk on port 8765 is healthy
    When the miniapp watchdog detects consecutive probe failures at or above its threshold
    Then the recovery path does not run stop_bridge_headless.sh for that root
    And the runtime log does not contain miniapp-watchdog bounced for that recovery

  # BL-1161 stop-bridge-refuses-front-desk-02
  Scenario: stop_bridge_headless refuses to SIGTERM bridge children while front-desk-supervisor is alive
    Given front-desk-supervisor.pid is alive for the fixture root
    And a start-bridge-headless.js child is running for that root on port 8765
    When stop_bridge_headless.sh is invoked for that root
    Then the bridge child pid remains alive
    And stop_bridge_headless reports that front desk owns the stack

  # BL-1161 bridge-survives-sixty-seconds-03
  Scenario: the bridge stays up for sixty seconds with operator_runtime running
    Given operator_runtime is running for the fixture root
    And lets-talk on port 8765 is healthy after cold start
    When sixty seconds elapse with no manual re-arm
    Then lets-talk on port 8765 stays healthy throughout
    And the runtime log contains no miniapp-watchdog bounced entry in that window

  # BL-1161 resident-spy-origin-200-04
  Scenario: the named resident-spy origin returns 200 while operator_runtime holds the bridge up
    Given operator_runtime is running for the fixture root
    And the bridge has reached a healthy lets-talk state on port 8765
    When the resident-spy route is probed on the bridge listen port for sixty seconds
    Then every probe response status is 200
