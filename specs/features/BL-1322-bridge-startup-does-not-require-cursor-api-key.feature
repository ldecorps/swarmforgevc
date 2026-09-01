Feature: bridge startup does not require CURSOR_API_KEY until a Cursor prompt is actually sent

  # BL-1322. QA (BL-1313 pass, 2026-09-01) found 8 test files / ~187 tests
  # newly failing with "CURSOR_API_KEY is not set for the headless bridge" —
  # thrown from resolveCursorApiKey, reached via
  # createLiveCursorBridgeAgentSession(targetPath) at bridgeServer.ts:2026,
  # which is called unconditionally on every startBridge() unless the caller
  # explicitly overrides options.letsTalk.agentSession. This fires even for
  # routes that never touch Cursor / Let's Talk (e.g. /backlog, /epic-reorder,
  # /paused-pager, /spec-tree) and even in production: a target with no
  # CURSOR_API_KEY configured cannot start the bridge server at all today,
  # regardless of whether it ever uses Let's Talk.
  #
  # The fix scope is narrow: constructing a Cursor agent session must not by
  # itself require the API key. The key is only genuinely needed to open a
  # Cursor SDK agent and send it a prompt — reading the stored agent id or
  # resetting session state does not touch the SDK at all.

  Background:
    Given CURSOR_API_KEY is not set in the environment
    And CURSOR_API_KEY is not set in swarm.env

  # BL-1322 bridge-starts-without-key-01
  Scenario: the bridge starts without CURSOR_API_KEY set
    When the bridge server is started for a target with no Let's Talk agent session override
    Then bridge startup succeeds without throwing

  # BL-1322 non-cursor-route-still-works-02
  Scenario: a non-cursor bridge route still works without CURSOR_API_KEY
    Given the bridge server has started for a target with no Let's Talk agent session override
    When a request is made to a bridge route that never exercises Cursor / Let's Talk routing
    Then the request is served normally

  # BL-1322 reading-stored-agent-id-does-not-need-key-03
  Scenario: reading the stored Cursor agent id does not require CURSOR_API_KEY
    Given the bridge server has started for a target with no Let's Talk agent session override
    When the stored Cursor agent id is read
    Then the read succeeds without requiring CURSOR_API_KEY

  # BL-1322 lets-talk-turn-still-fails-loud-04
  Scenario: sending a Let's Talk turn without CURSOR_API_KEY still fails with the documented error
    Given the bridge server has started for a target with no Let's Talk agent session override
    When a Let's Talk turn is submitted
    Then the request fails with the CURSOR_API_KEY missing error
    And the operator is told to set CURSOR_API_KEY in swarm.env and restart the bridge supervisor
