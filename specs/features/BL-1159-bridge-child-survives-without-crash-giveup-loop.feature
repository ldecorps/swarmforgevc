Feature: the front-desk bridge child stays up after cold start without a crash give-up loop

  # BL-1159: after BL-1158/1154/1151, the bridge child still exits 4–6 seconds
  # after BRIDGE_LISTENING (:crashed, not :build-stale), cycling to gave-up.
  # Distinct from build-stale budget accounting (BL-1154) and dual-supervisor
  # ownership (BL-1158). Live 2026-08-26: extension/out/BUILD_SHA matched HEAD;
  # recompile did not stop the loop.

  Background:
    Given a cold front-desk supervisor start with Telegram configured
    And extension/out/BUILD_SHA matches the current git HEAD

  # BL-1159 bridge-stable-ten-minutes-01
  Scenario: the bridge child survives ten minutes with a stable pid
    When the supervisor starts the bridge child
    And ten minutes elapse with no manual re-arm
    Then the front-desk status JSON shows bridge status running
    And the bridge pid is unchanged from its post-start value

  # BL-1159 lets-talk-continuous-02
  Scenario: lets-talk stays reachable over the stable window
    Given the bridge has reached running status after cold start
    When lets-talk is probed every minute for ten minutes
    Then every probe to http://127.0.0.1:8765/lets-talk succeeds

  # BL-1159 no-crash-giveup-cycle-03
  Scenario: the supervisor log shows no crash give-up loop without a healthy period
    When the supervisor runs through the ten-minute stable window
    Then the log contains no repeated crashed bridge entries without an intervening healthy period
    And the log contains no gave-up bridge cycle within that window

  # BL-1159 resident-spy-origin-200-04
  Scenario: the named resident-spy origin returns 200 while the bridge is up
    Given the bridge has reached running status after cold start
    When the resident-spy route is probed on the bridge listen port
    Then the response status is 200
