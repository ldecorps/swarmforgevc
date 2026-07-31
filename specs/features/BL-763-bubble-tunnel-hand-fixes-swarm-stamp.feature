Feature: Stamp hand Bubble tunnel revive fixes (meta bounce + always-on path)
  Outside/IDE tunnel revive work is adopted under BL-763: the bridge exposes
  instance meta, Bounce detection can refresh a session, and Cursor Remote
  stays always-on across ancillary stop. Hostname discovery remains BL-716.
  Source: human via Cursor 2026-07-31; BL-763.

  # BL-763 meta-01
  Scenario: live bridge serves instance metadata
    Given a headless Let's Talk bridge is listening
    When a client GETs /lets-talk/meta
    Then the response is JSON with a non-empty instanceId
    And a subsequent GET against the same process returns the same instanceId

  # BL-763 meta-02
  Scenario: bridge bounce yields a new instanceId
    Given a client has observed instanceId A from /lets-talk/meta
    When the bridge process is restarted and becomes healthy again
    And the client GETs /lets-talk/meta
    Then the response instanceId is not A

  # BL-763 session-01
  Scenario: Bubble opens one new session when the bridge instance changes
    Given Bubble has stored a previous bridge instanceId
    And remote config enables bridge bounce auto session reset
    When /lets-talk/meta reports a different instanceId
    Then Bubble calls /lets-talk/new-session once for that change
    And it does not call new-session again while the instanceId stays the same

  # BL-763 lifecycle-01
  Scenario: stop_ancillary leaves Cursor Remote bridge running
    Given the Cursor Remote bridge supervisor is running
    When stop_ancillary_services.sh completes
    Then the Cursor Remote bridge supervisor is still running
    And an explicit stop_cursor_bridge.sh is required to tear it down

  # BL-763 lifecycle-02
  Scenario: start_ancillary brings Cursor Remote up when creds are present
    Given Cursor Remote bridge is not running
    And Telegram / Cursor bridge credentials are configured
    And SWARMFORGE_SKIP_CURSOR_BRIDGE is unset
    When start_ancillary_services.sh runs
    Then the Cursor Remote bridge supervisor is started

  # BL-763 boundary-01
  Scenario: this ticket does not claim stale-hostname discovery is fixed
    Given a phone still paired to a dead trycloudflare hostname
    When a Let's Talk turn is attempted
    Then the failure remains a host or DNS class error
    And fixing it still requires BL-716 discovery or manual re-pair
