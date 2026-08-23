Feature: A lost tick baseline never re-posts an approval ask that is already live

  The concierge posts an approval ask in three separate writes: send it to the
  Approvals topic, record it in the ask store, then persist the tick state that
  says the transition happened. A crash after the first two and before the third
  leaves the durable baseline claiming the ticket was never pending.

  Two consumers read that state. Reconcile already asks the ask store whether an
  ask is on the live Approvals topic, and correctly stays quiet. The edge path
  diffs snapshots only, never consults the ask store, re-derives the same
  transition and posts a second byte-identical buttoned ask. The half that wins
  is the half that posts, and the human is left with two asks and no way to tell
  whether the first tap registered.

  One predicate answers "is this ask already live" for both consumers, so they
  cannot disagree. Suppressing an edge event also records it as emitted, so the
  durable state catches up instead of re-deriving it forever. An ask recorded
  against a topic id that is NOT the live Approvals topic is a remint and is
  still re-posted - trading a duplicate ask for a lost one would be worse than
  the defect being fixed.

  Background:
    Given a standing Approvals topic exists
    And a ticket is awaiting human approval

  # BL-1090 a-lost-tick-baseline-reposts-an-exact-duplicate-approval-ask-01
  Scenario: a baseline lost to a crash suppresses the re-post and catches the durable state up
    Given the ticket's ask is recorded against the live Approvals topic
    And the durable tick state was never written for that transition
    When the concierge tick runs
    Then no approval ask is sent for the ticket
    And the durable tick state records the approval transition as already emitted
    And the durable tick state still lists the ticket as awaiting approval

  # BL-1090 a-lost-tick-baseline-reposts-an-exact-duplicate-approval-ask-02
  Scenario: an ask recorded against a stale topic id is still re-posted onto the live topic
    Given the ticket's ask is recorded against a topic id that is not the live Approvals topic
    And the durable tick state was never written for that transition
    When the concierge tick runs
    Then exactly one approval ask is sent for the ticket
    And the approval ask is sent to the live Approvals topic

  # BL-1090 a-lost-tick-baseline-reposts-an-exact-duplicate-approval-ask-03
  Scenario: a newly pending ticket with no recorded ask is asked about exactly once
    Given the ticket's ask is recorded nowhere
    And the durable tick state was never written for that transition
    When the concierge tick runs
    Then exactly one approval ask is sent for the ticket
    And the approval ask is sent to the live Approvals topic

  # BL-1090 a-lost-tick-baseline-reposts-an-exact-duplicate-approval-ask-04
  Scenario Outline: the reconcile path and the edge path classify a recorded ask identically
    Given the ticket's ask is recorded <ask location>
    When each path is asked whether that ask is already live
    Then both paths answer <already live>

    Examples:
      | ask location                                            | already live |
      | against the live Approvals topic                        | yes          |
      | against a topic id that is not the live Approvals topic | no           |
      | nowhere                                                 | no           |
