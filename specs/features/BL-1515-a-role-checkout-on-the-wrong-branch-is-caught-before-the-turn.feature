Feature: BL-1515 a role checkout on the wrong branch is caught before the turn
  A role's declared branch is the session column of its roles.tsv row, the
  same field tree_collapse_guard_lib.bb resolves. ready_for_next.bb runs a
  branch-identity guard before it reads the inbox: a match is silent, the
  one provably safe mismatch is repaired by renaming, and every other
  mismatch refuses and touches no ref.

  Background:
    Given a fixture repository under mkdtemp with a coder worktree
    And roles.tsv declares the coder's session as "swarmforge-coder"

  # BL-1515 branch-identity-guard-01
  Scenario: a worktree on its declared branch proceeds silently
    Given the coder worktree is checked out on "swarmforge-coder"
    When ready_for_next runs as coder
    Then no BRANCH_DRIFT line is printed
    And the turn proceeds to read the inbox

  # BL-1515 branch-identity-guard-02
  Scenario: the declared ref is absent and the checked-out branch contains its origin tip, so the guard renames
    Given the local ref "swarmforge-coder" does not exist
    And "origin/swarmforge-coder" is an ancestor of the checked-out branch "side"
    When ready_for_next runs as coder
    Then a line "BRANCH_DRIFT_REPAIRED role=coder from=side to=swarmforge-coder" is printed
    And the coder worktree is checked out on "swarmforge-coder" at the same commit
    And the turn proceeds to read the inbox

  # BL-1515 branch-identity-guard-03
  Scenario: the declared ref exists at a different tip, so the guard refuses and changes nothing
    Given the local ref "swarmforge-coder" exists at a commit that is not the checked-out tip
    And the coder worktree is checked out on "side"
    When ready_for_next runs as coder
    Then it exits 2 with a line starting "BRANCH_DRIFT_DETECTED role=coder declared=swarmforge-coder actual=side"
    And the line names both the declared tip and the actual tip
    And every ref and HEAD are unchanged
    And nothing is moved into in_process

  # BL-1515 branch-identity-guard-04
  Scenario: a detached HEAD refuses and changes nothing
    Given the coder worktree has a detached HEAD
    When ready_for_next runs as coder
    Then it exits 2 with a line starting "BRANCH_DRIFT_DETECTED role=coder"
    And every ref and HEAD are unchanged
    And nothing is moved into in_process

  # BL-1515 branch-identity-guard-05
  Scenario: a repair is idempotent
    Given the guard has already renamed "side" to "swarmforge-coder"
    When ready_for_next runs as coder
    Then no BRANCH_DRIFT line is printed
    And the turn proceeds to read the inbox

  # BL-1515 branch-identity-guard-06
  Scenario: a master-resident role is exempt even when checked out on neither declared session
    Given roles.tsv declares two master-resident roles "specifier" and "coordinator" sharing one worktree with sessions "swarmforge-specifier" and "swarmforge-coordinator"
    And the shared master worktree is checked out on "main"
    When ready_for_next runs as "specifier" in the shared master worktree
    Then no BRANCH_DRIFT line is printed
    And no ref is renamed in the shared master worktree
    And the turn proceeds to read the inbox
