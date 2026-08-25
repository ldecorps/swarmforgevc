Feature: BL-1138 residual — refuse-rematch must rematch live (not wait for Cursor)
  BL-1138 made :replay-bookkeeping execute rematch (`git reset --hard
  origin/main`) so rematch-bookkeeping no longer durable-deadlocks. Same
  evening, live master sync still stuck on wait-reconcile with surfaced
  refuse-rematch (measured ahead≈12 behind=3 ticks≥13) until a human
  rematched — that join was clean under ort. Root cause in the live path:
  handoffd master-main-reconcile-merge! maps :refuse-rematch to a hard
  failure that only surfaces, and post_hotfix run-post-hotfix-merge!
  print-refuse-rematch! then exits 1 without rematching. Residual: when
  absorb-dispatch chooses :refuse-rematch, recovery must execute rematch
  (or equivalent automatic rematch onto origin/main) so behind returns to
  0 and the refuse-rematch surface clears — never standing wait-reconcile
  / Complete-origin/main-merge for Cursor. BL-1130 clean-refuse posture
  and BL-1120 foreign-merge skip stay. Source: human Cursor 2026-08-25
  after ops rematch; intake archived as
  backlog/archive/INTAKE-bl1138-residual-refuse-rematch-not-executed.md.

  Background:
    Given a master checkout whose absorb-dispatch plan is refuse-rematch
    And BL-1130 forbids leaving MERGE_HEAD for an editor
    And BL-1120 forbids aborting a foreign MERGE_HEAD this tick did not start

  # BL-1141 handoffd-refuse-rematch-recovers-behind-zero-01
  Scenario: handoffd refuse-rematch rematches to behind=0
    When master-main-reconcile-merge! takes the refuse-rematch branch
    Then it rematches onto origin/main (or equivalent automatic rematch)
    And local main reaches behind=0 without Complete-origin/main-merge
    And main_sync_status_cli action is proceed or ff-only

  # BL-1141 process-b-refuse-rematch-rematches-02
  Scenario: Process B refuse-rematch rematches rather than exit-only
    When post_hotfix run-post-hotfix-merge! takes the refuse-rematch branch
    Then it rematches (or equivalent) instead of only print-refuse-rematch! + exit 1
    And behind returns to 0 on success

  # BL-1141 merge-head-and-foreign-merge-hold-03
  Scenario: BL-1130 and BL-1120 hold under refuse-rematch recovery
    When refuse-rematch recovery runs
    Then the worktree is not left with MERGE_HEAD or unmerged paths for an editor
    And a foreign MERGE_HEAD present at tick start is not aborted

  # BL-1141 refuse-rematch-surface-clears-04
  Scenario: surfaced refuse-rematch does not stand after recovery
    Given reconcile state surfaced refuse-rematch
    When rematch recovery succeeds
    Then reconcile surfaced refuse-rematch is cleared
    And wait-reconcile with refuse-rematch is not the standing end state
