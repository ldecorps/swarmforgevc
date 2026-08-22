# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-13T03:41:49.025174Z","feature_name":"Approvals queue-jump is labeled Q jump and reachable by a /qjump front-desk verb","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-721-approvals-q-jump-label-and-telegram-verb.feature","background_hash":"dba2542357e9905821178239ae3e522b2c61f8c09ce9b8e634bb5adc4f590db9","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: Approvals queue-jump is labeled Q jump and reachable by a /qjump front-desk verb

  Background:
    Given an approval ask was posted in a ticket's Telegram topic
    And the posted ask is the BL-410 inline-keyboard approval ask

  # BL-721 q-jump-approvals-01
  Scenario: The approval ask's fourth button is labeled Q jump instead of Expedite
    When the approval ask's buttons are rendered for a ticket
    Then the rendered buttons include a button labeled "Q jump"
    And no rendered button is labeled "Expedite"
    And the Q jump button carries the expedite verb tagged with the ticket id

  # BL-721 q-jump-approvals-02
  Scenario: A queue-jumped ask closes with Q jump vocabulary
    Given the ticket is still pending review
    When the Q jump button is tapped for the ticket
    Then the posted ask's inline keyboard is removed
    And a Q jumped decision line with the recorded UTC time is appended to the message

  # BL-721 q-jump-approvals-03
  Scenario: A /qjump message performs the same queue-jump effects as the Q jump button
    Given the ticket is in the paused backlog
    And the ticket is still pending review
    When a /qjump message naming the ticket is received on the front desk
    Then the ticket's human_approval is recorded as approved
    And the ticket is moved into the active backlog
    And a routing handoff is injected to start the build immediately
    And the queue-jump effects are performed through the same effect path the Q jump button uses

  # BL-721 q-jump-approvals-04
  Scenario: A /qjump message never starts the offline expeditor
    When a /qjump message naming the ticket is received on the front desk
    Then no offline expeditor run is started
