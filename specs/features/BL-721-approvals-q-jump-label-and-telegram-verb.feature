Feature: Approvals Q jump - a renamed button, a typed verb, and separation from the offline expeditor

# BL-721 acceptance criteria (human via Let's Talk 2026-07-30): the Approvals
# ask's fourth button read "Expedite", which people confused with the
# offline Cursor-bridge expeditor (/expedite). Rename the human-visible
# label to "Q jump" - same three effects as BL-490 (approve, force-promote
# paused->active, dispatch now), same callback_data namespace, for
# compatibility. Add a Telegram front-desk verb "/qjump <id>" in the
# Approvals topic so the same queue-jump can be typed without hunting the
# ask buttons. The offline expeditor keeps its own "/expedite" verb
# (Cursor-bridge topic only) unchanged - queue-jump and the offline
# expeditor are, and must stay, two distinct commands.

  Background:
    Given a Q jump-eligible approval ask was posted in a ticket's Telegram topic

  # BL-721-01
  Scenario: The approval ask's fourth button reads Q jump, not Expedite
    When the Q jump ask's buttons are rendered for the ticket
    Then the rendered buttons include a Q jump button, not an Expedite button
    And the Q jump button carries the expedite verb tagged with the ticket id
    And the Approve, Amend, and Reject buttons are still present alongside Q jump

  # BL-721-02
  Scenario: Tapping Q jump still performs the full BL-490 approve, force-promote, and dispatch effect
    Given the ticket starts out paused, awaiting Q jump
    When the Q jump button is tapped for the ticket
    Then the ticket's human_approval is approved by the Q jump effect
    And the Q jump effect moves the ticket into the active backlog
    And the Q jump effect dispatches a routing handoff to start the build immediately

  # BL-721-03
  Scenario: Tapping Q jump closes the ask with a Q jumped decision line, not Expedited
    Given the Q jump ask has not yet been decided
    When the Q jump button is tapped for the ticket
    Then the Q jump ask's inline keyboard is removed
    And a Q jumped decision line with the recorded UTC time is appended to the message

  # BL-721-04
  Scenario: A typed "/qjump <id>" reply in the Approvals topic performs the same queue-jump effect as tapping the button
    Given the Q jump ask has not yet been decided
    When "/qjump" is typed for the ticket as a reply in the Approvals topic
    Then the ticket's human_approval is approved by the Q jump effect
    And the Q jump effect dispatches a routing handoff to start the build immediately

  # BL-721-05
  Scenario: A typed "/qjump <id>" on a same-file collision skips dispatch and warns in the Approvals topic, without preempting the in-flight build
    Given another in-flight build already edits the same files as this ticket
    When "/qjump" is typed for the ticket as a reply in the Approvals topic
    Then an unsafe-dispatch warning is posted into the Approvals topic
    And no dispatch is performed for the ticket, though it is still approved

  # BL-721-06
  Scenario: The offline expeditor stays on /expedite - a typed /qjump never starts it, and /expedite never queue-jumps
    When "/expedite" is typed for the ticket as a reply in the Approvals topic
    Then no approval, promotion, or dispatch side effect is performed for the ticket
    And the offline expeditor's own parser still recognizes /expedite for that ticket, unchanged
