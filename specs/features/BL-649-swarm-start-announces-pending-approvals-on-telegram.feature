Feature: swarm start posts a doorbell announcement for pending approvals on Telegram

  # BL-649: BL-434's Approvals roster edits in place and never pings the phone. At swarm start,
  # when human_approval: pending tickets exist (active+paused per computeNeedsApproval), POST one NEW
  # message listing id, age, and approval_context — not an edit. Restart-spam gated on pending-set
  # identity; roster behavior byte-identical to BL-434. Content from yaml fields only, never pane capture.

  Background:
    Given a standing Approvals topic exists
    And the front desk bot is up after swarm start

  # BL-649 doorbell-posts-pending-01
  Scenario: swarm start with pending approvals posts one new listing message on the Approvals topic
    Given N tickets in active or paused carry human_approval pending
    When swarm start runs the pending-approval announcement hook
    Then exactly one new message is posted to the Approvals topic not an edit
    And each listed ticket shows id pending age and an approval_context derived line

  # BL-649 zero-pending-silent-02
  Scenario: swarm start with zero pending approvals posts nothing
    Given no ticket in active or paused carries human_approval pending
    When swarm start runs the pending-approval announcement hook
    Then no message is posted to the Approvals topic

  # BL-649 restart-spam-guard-03
  Scenario: two consecutive starts with the same pending set produce one announcement
    Given the same pending approval set across two swarm starts
    When swarm start runs the pending-approval announcement hook twice without set change
    Then exactly one announcement message was posted across both starts

  # BL-649 set-changed-reannounce-04
  Scenario: a changed pending set between starts triggers a fresh announcement naming the delta
    Given one pending ticket on the first swarm start
    And a second ticket becomes pending before the next swarm start
    When swarm start runs the pending-approval announcement hook after each start
    Then the second announcement names the newly pending ticket

  # BL-649 existing-reply-path-05
  Scenario: approving from the Approvals topic uses the existing pendingApprovalReply path only
    Given a ticket listed in the start announcement is pending in the Approvals topic
    When the human replies approve for that ticket id in the Approvals topic
    Then pendingApprovalReply records the approval for that ticket
    And no second approval write path is introduced

  # BL-649 roster-byte-identical-06
  Scenario: the approvals roster message behavior stays byte-identical to BL-434
    Given pending tickets and a roster message already maintained by approvalsRosterSync
    When swarm start runs the pending-approval announcement hook
    Then approvalsRosterSync edit-in-place roster behavior is unchanged from BL-434

  # BL-649 yaml-fields-not-pane-07
  Scenario: announcement lines are rendered from ticket yaml fields never from pane capture
    Given a pending ticket whose approval_context and title live only in its yaml
    When swarm start runs the pending-approval announcement hook
    Then the posted announcement lines quote those yaml fields
    And no announcement line is sourced from tmux pane or terminal capture text
