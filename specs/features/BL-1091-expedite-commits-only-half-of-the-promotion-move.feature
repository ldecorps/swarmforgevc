# mutation-stamp: sha256=4b39c04c6c3eac9a93f65ecfaee3794c4a08884358cf2e0751da8295da728cbe
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T10:45:02.894357320Z","feature_name":"A backlog promotion is committed as both of its paths","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1091-expedite-commits-only-half-of-the-promotion-move.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":2,"name":"An in-place approval writer still commits exactly one path","scenario_hash":"8316945690e7cf3c29f1bc8245fe3ba0728e7f04b4342fe69d9ca882107e3b3a","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-08-24T10:45:02.894357320Z"}]}
# acceptance-mutation-manifest-end

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
