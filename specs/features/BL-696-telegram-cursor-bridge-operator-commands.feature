Feature: Telegram Cursor Remote operator commands

  # BL-696 follow-up (2026-07-28): operator skills on the Cursor Remote
  # Telegram topic — /expedite, /reexpedite, /redeploy, /log, /update, plus
  # non-blocking agent runs with throttled progress posts.
  #
  # Pure decision + handler wiring is exercised against the REAL compiled
  # telegramCursorBridge* modules (no Telegram network I/O).

  Background:
    Given the Cursor Remote Telegram topic is bound for the principal
    And the cursor bridge handler context is ready

  # BL-696 tg-op-01
  Scenario: /expedite spawns a detached offline expeditor
    When the principal sends "/expedite BL-696" on the Cursor Remote topic
    Then the bridge decision is to start expedite for ticket "BL-696"
    And the bridge posts an expedite started confirmation

  # BL-696 tg-op-02
  Scenario: /expedite without a ticket defaults to BL-696
    When the principal sends "/expedite" on the Cursor Remote topic
    Then the bridge decision is to start expedite for ticket "BL-696"

  # BL-696 tg-op-02b
  Scenario: /pilot starts a Cursor-staffed offline expedition
    When the principal sends "/pilot BL-700" on the Cursor Remote topic
    Then the bridge decision is to start pilot for ticket "BL-700"
    And the bridge posts a pilot started confirmation
    And the Cursor agent is prompted as the offline expeditor for "BL-700"

  # BL-696 tg-op-02c
  Scenario: /pilot without a ticket defaults to BL-696
    When the principal sends "/pilot" on the Cursor Remote topic
    Then the bridge decision is to start pilot for ticket "BL-696"

  # BL-696 tg-op-03
  Scenario: /reexpedite checkpoints WIP and relaunches expedite
    When the principal sends "/reexpedite BL-696" on the Cursor Remote topic
    Then the bridge decision is to start reexpedite for ticket "BL-696"
    And the bridge posts a reexpedite started confirmation

  # BL-696 tg-op-04
  Scenario: /redeploy compiles and restarts the supervised bridge
    When the principal sends "/redeploy" on the Cursor Remote topic
    Then the bridge decision is to redeploy
    And the bridge posts a redeploy started confirmation

  # BL-696 tg-op-05
  Scenario: /log tails the expedite operator log for a ticket
    Given an expedite operator log exists for ticket "BL-696"
    When the principal sends "/log expedite BL-696" on the Cursor Remote topic
    Then the bridge posts the expedite log tail

  # BL-696 tg-op-06
  Scenario: /log auto-selects the running expedite log
    Given expedite progress is running for ticket "BL-696"
    When the principal sends "/log" on the Cursor Remote topic
    Then the bridge posts log content mentioning "BL-696"

  # BL-696 tg-op-07
  Scenario: /update summarizes expedite progress and swarm work
    Given expedite progress is running for ticket "BL-696"
    And ticket "BL-696" is in backlog active with role "specifier"
    When the principal sends "/update" on the Cursor Remote topic
    Then the bridge posts an update mentioning "BL-696"
    And the bridge posts an update mentioning "Swarm: working"
    And the bridge posts an update mentioning "BL-696 @ specifier"

  # BL-696 tg-op-07b
  Scenario: /update reports swarm sleeping when the active backlog is empty
    When the principal sends "/update" on the Cursor Remote topic
    Then the bridge posts an update mentioning "Swarm: sleeping"

  # BL-696 tg-op-08
  Scenario: /update works while a Cursor agent run is in flight
    Given a long-running Cursor agent prompt is in flight
    When the principal sends "/update" on the Cursor Remote topic while busy
    Then the bridge posts an update mentioning "Agent run in progress"
    And the bridge remains busy until the agent run completes

  # BL-696 tg-op-09
  Scenario: progress posts during an agent run do not quote the original prompt
    When the principal sends a Cursor agent prompt on the Cursor Remote topic
    And the agent emits a tool progress line
    Then the progress post does not reply to the original prompt message

  # BL-696 tg-op-10
  Scenario: assistant stream fragments are not posted as progress noise
    When an assistant stream chunk ")." is summarized for Telegram progress
    Then no progress line is produced

  # BL-696 tg-op-11
  Scenario: a second prompt while busy is rejected
    Given a long-running Cursor agent prompt is in flight
    When the principal sends another agent prompt on the Cursor Remote topic while busy
    Then the bridge posts a busy refusal

  # BL-696 tg-op-12
  Scenario: a Telegram photo is forwarded to the Cursor agent
    When the principal sends a photo with caption "what is this?" on the Cursor Remote topic
    Then the bridge forwards the photo to the Cursor agent

  # BL-696 tg-op-13
  Scenario: /status and /update remain available while busy
    Given a long-running Cursor agent prompt is in flight
    When the principal sends "/status" on the Cursor Remote topic while busy
    Then the bridge posts a status mentioning "busy"
    When the principal sends "/update" on the Cursor Remote topic while busy
    Then the bridge posts an update mentioning "Agent run in progress"
