# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T11:41:19.965837332Z","feature_name":"BL-1120 handoffd must not abort a foreign master-main merge","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1120-handoffd-must-not-abort-foreign-merge.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-1120 handoffd must not abort a foreign master-main merge
  handoffd's master-main reconcile must never git merge --abort a merge
  that this tick did not start. A pre-existing MERGE_HEAD means a human
  (or other agent) owns the merge — skip and surface, do not abort.

  # BL-1120 preexisting-merge-head-01
  Scenario: a tick that sees MERGE_HEAD already set leaves the merge alone
    Given the master checkout already has MERGE_HEAD from a human merge in progress
    When master-main-reconcile-merge runs
    Then it does not run git merge --abort
    And the checkout remains mid-merge
    And the outcome names human-merge-in-progress

  # BL-1120 tick-started-conflict-still-aborts-02
  Scenario: a conflict on a merge this tick started may still abort
    Given the master checkout is clean with no MERGE_HEAD
    And merging origin/main would conflict
    When master-main-reconcile-merge runs
    Then it may abort the merge it started
    And the worktree is left not mid-merge
