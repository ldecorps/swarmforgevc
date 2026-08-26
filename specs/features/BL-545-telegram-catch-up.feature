Feature: Telegram catch-up pager on the SwarmForge console Mini App

  # Human-requested 2026-07-21: Teams-style catch-up for unread agent messages
  # across Telegram forum topics. Slice of epic swarmforge-console / BL-517.
  # Depends on BL-516 (allowlisted operator channel) and rides the same Mini
  # App bridge host as BL-526 / BL-538.
  #
  # HOST: Telegram Mini App HTML served by extension/src/bridge/bridgeServer.ts
  # at /catch-up with JSON feed GET /catch-up-state and control-scoped POST
  # /catch-up/mark-read. Fourth button on the BL-526 console menu.
  #
  # QUEUE: on open, the client asynchronously fetches all unread outbound
  # (agent) messages from backlog/topics/*.json into an in-memory queue,
  # oldest-first. Triage starts at the LAST (newest) unread message; each
  # button advances to the next older message. When the queue is exhausted,
  # show "All caught up".
  #
  # READ STATE: host-persisted per-message markers in
  # .swarmforge/catch-up-read-state.json (never browser storage).

  Background:
    Given the SwarmForge bridge Mini App is reachable with my allowlisted console token
    And the console menu at /console is available

  # BL-545 catch-up-open-01
  Scenario: opening catch-up builds the unread queue and shows the newest agent message
    Given unread outbound messages exist across one or more backlog topic records
    When I open the catch-up pager from the console menu
    Then the page shows the newest unread message with sender, topic label, and how long ago
    And shows "Mark as read" and "Keep as unread" controls

  # BL-545 catch-up-empty-02
  Scenario: catch-up shows all caught up when nothing is unread
    Given every outbound topic message is already marked read
    When I open the catch-up pager
    Then I see "All caught up" and no triage controls

  # BL-545 catch-up-mark-read-03
  Scenario: mark as read persists and advances to the next older unread message
    Given two or more unread outbound messages exist
    And I am viewing the newest unread message on the catch-up pager
    When I tap "Mark as read"
    Then that message is recorded as read on the host
    And the pager shows the next older unread message

  # BL-545 catch-up-keep-unread-04
  Scenario: keep as unread advances without persisting read state
    Given two or more unread outbound messages exist
    And I am viewing the newest unread message on the catch-up pager
    When I tap "Keep as unread"
    Then that message is not recorded as read on the host
    And the pager shows the next older unread message

  # BL-545 catch-up-done-05
  Scenario: finishing the queue shows all caught up
    Given one unread outbound message exists
    When I triage that message with either button
    Then I see "All caught up"

  # BL-545 catch-up-offline-06
  Scenario: once the queue is built I can triage offline through the in-memory queue
    Given unread outbound messages exist
    And the catch-up pager has finished loading its in-memory queue
    When the network is unavailable
    Then I can still advance through the queue with "Keep as unread"
    And "Mark as read" advances locally even if the persist call fails
