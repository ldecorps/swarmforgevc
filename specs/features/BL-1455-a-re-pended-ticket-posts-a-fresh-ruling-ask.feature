Feature: A re-pended ticket posts a fresh ruling ask

  A ticket's human_approval can legitimately go back to pending after it was
  approved: the specifier re-pends it to collect a ruling the first approval
  never posed, or because a new scenario needs a second tap. The concierge is
  meant to notice the not-pending to pending edge and post a fresh buttoned
  ask carrying the ticket's CURRENT ruling_options.

  It does not. When the first approval landed, the concierge closed the old
  ask: it edited the message to append a decided stamp, stripped its inline
  keyboard, and kept the record in the ask store with the decided text. That
  record still names the live Approvals topic. BL-1090's duplicate guard reads
  "recorded on the live topic" as "already live", so the edge event for the
  re-pend is dropped and marked emitted, and reconcile - whose only no-record
  branch is guarded by that same emitted key - never synthesizes one either.
  The human sees the ticket in the awaiting-approval roster, opens a message
  stamped decided days ago with no buttons on it, and the ticket parks forever.

  A closed ask is history, not a live ask. Only an undecided ask on the live
  Approvals topic may suppress a post; a decided one must let the fresh ask
  through and be replaced by it in the store. BL-1090's guarantee stands: an
  UNDECIDED ask on the live topic is still never duplicated.

  Background:
    Given a standing Approvals topic exists

  # BL-1455 a-re-pended-ticket-posts-a-fresh-ruling-ask-01
  Scenario Outline: a ticket approved earlier and re-pended is asked about again with its current keyboard
    Given a ticket was approved and its ask on the live Approvals topic was closed
    And the ticket is re-pended <ruling options>
    When the concierge tick runs
    Then exactly one approval ask is sent for the ticket
    And the approval ask is sent to the live Approvals topic
    And the approval ask's keyboard carries <keyboard>

    Examples:
      | ruling options           | keyboard                     |
      | with four ruling options | one button per ruling option |
      | with no ruling options   | the plain decision buttons   |

  # BL-1455 a-re-pended-ticket-posts-a-fresh-ruling-ask-02
  Scenario: a live undecided ask is still never duplicated
    Given a ticket is awaiting human approval
    And the ticket's undecided ask is recorded against the live Approvals topic
    And the durable tick state was never written for that transition
    When the concierge tick runs
    Then no approval ask is sent for the ticket

  # BL-1455 a-re-pended-ticket-posts-a-fresh-ruling-ask-03
  Scenario: a closed ask on a ticket that stays approved posts nothing
    Given a ticket was approved and its ask on the live Approvals topic was closed
    And the ticket stays approved
    When the concierge tick runs
    Then no approval ask is sent for the ticket

  # BL-1455 a-re-pended-ticket-posts-a-fresh-ruling-ask-04
  Scenario: the fresh ask becomes the ticket's live ask and the closed message is left as history
    Given a ticket was approved and its ask on the live Approvals topic was closed
    And the ticket is re-pended for a second ruling
    When the concierge tick runs
    Then the ask store records the fresh ask as the ticket's live ask
    And the closed ask's message is not edited

  # BL-1455 a-re-pended-ticket-posts-a-fresh-ruling-ask-05
  Scenario: the tick after the fresh ask sends nothing
    Given a ticket was approved and its ask on the live Approvals topic was closed
    And the ticket is re-pended for a second ruling
    And the previous concierge tick already posted the fresh ask
    When the concierge tick runs
    Then no approval ask is sent for the ticket

  # BL-1455 a-re-pended-ticket-posts-a-fresh-ruling-ask-06
  Scenario: a ticket the durable baseline already holds pending with only a closed ask is still asked about
    Given a ticket was approved and its ask on the live Approvals topic was closed
    And the ticket is re-pended for a second ruling
    And the durable tick state already lists the ticket as awaiting approval with its ask counted as emitted
    When the concierge tick runs
    Then exactly one approval ask is sent for the ticket
    And the approval ask is sent to the live Approvals topic
