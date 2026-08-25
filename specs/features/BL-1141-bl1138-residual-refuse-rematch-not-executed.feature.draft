Feature: BL-1141 — refuse-rematch must rematch live (not wait for Cursor)
  # Draft acceptance — specifier confirms/fills. Soft-mint residual of BL-1138.

  Background:
    Given a master checkout whose absorb-dispatch plan is refuse-rematch
    And BL-1130 forbids leaving MERGE_HEAD for an editor
    And BL-1120 forbids aborting a foreign MERGE_HEAD this tick did not start

  Scenario: handoffd refuse-rematch rematches to behind=0
    When master-main-reconcile-merge! takes the refuse-rematch branch
    Then it rematches onto origin/main (or equivalent automatic rematch)
    And local main reaches behind=0 without Complete-origin/main-merge
    And main_sync_status_cli action is proceed or ff-only

  Scenario: Process B refuse-rematch rematches rather than exit-only
    When post_hotfix run-post-hotfix-merge! takes the refuse-rematch branch
    Then it rematches (or equivalent) instead of only print-refuse-rematch! + exit 1
    And behind returns to 0 on success

  Scenario: BL-1130 and BL-1120 hold
    When refuse-rematch recovery runs
    Then the worktree is not left with MERGE_HEAD or unmerged paths for an editor
    And a foreign MERGE_HEAD present at tick start is not aborted

  Scenario: surfaced refuse-rematch does not stand after recovery
    Given reconcile state surfaced refuse-rematch
    When rematch recovery succeeds
    Then reconcile surfaced refuse-rematch is cleared
    And wait-reconcile with refuse-rematch is not the standing end state
