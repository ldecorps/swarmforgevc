Feature: A backlog promotion is committed as both of its paths

  Expedite both approves a ticket and promotes it, and a promotion is a
  rename: paused/ -> active/. The commit that records it is pathspec-scoped
  to protect a shared checkout from concurrent writers, so it must name BOTH
  ends of the rename. Naming only the destination lands the addition and
  leaves the deletion uncommitted, and the ticket goes live in two folders.

  The two callers that edit a ticket in place still commit exactly one path;
  that narrowing is correct for them and must survive this change.

  # BL-1091 promotion-commit-both-paths-01
  Scenario: Expediting a paused ticket commits both ends of the rename
    Given a ticket in backlog/paused/ awaiting approval
    When the operator expedites the ticket
    Then the resulting commit records a deletion under backlog/paused/
    And the resulting commit records an addition under backlog/active/
    And no uncommitted change for that ticket remains in the working tree
    And the ticket id appears in exactly one backlog folder

  # BL-1091 promotion-commit-both-paths-02
  Scenario: Expediting an already-active ticket still commits cleanly
    Given a ticket already in backlog/active/ awaiting approval
    When the operator expedites the ticket
    Then the resulting commit records the approval on the active path
    And no uncommitted change for that ticket remains in the working tree

  # BL-1091 promotion-commit-both-paths-03
  Scenario Outline: An in-place approval writer still commits exactly one path
    Given a ticket awaiting approval in whichever folder it already occupies
    When the operator records <verb> through the <writer> writer
    Then the resulting commit names exactly one path

    Examples:
      | verb    | writer     |
      | Approve | bridge     |
      | Approve | front-desk |
      | Reject  | front-desk |
      | Amend   | front-desk |
