# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T16:13:29.051720497Z","feature_name":"BL-1135 residual — rematch-bookkeeping must not durable-deadlock absorb","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1138-bl1135-residual-rematch-bookkeeping-deadlock.feature","background_hash":"abea6f255b756d8dfba0f32d193b71bba8bae94b8f2af2ec69648b159bf96a1c","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-1135 residual — rematch-bookkeeping must not durable-deadlock absorb
  BL-1135 closed claiming live lands reach behind=0 without Operator/Cursor
  completing an absorb merge. Measured same evening: reconcile surfaces
  rematch-bookkeeping, then main-sync trips deadlock-tripped and sticks —
  coordinator freezes closes (e.g. BL-568) while origin behind climbs and
  local bookkeeping stays ahead. Root cause in the live path:
  handoffd master-main-reconcile-merge! maps :replay-bookkeeping to a
  surfaced rematch-bookkeeping outcome and does not execute rematch/replay;
  deadlock then waits for a human. Residual: rematch-bookkeeping recovery
  must run (or reliably hand to an automatic rematch owner path) so behind
  returns to 0 and deadlock clears — never durable deadlock-tripped as the
  designed end state. BL-1130 clean-refuse and BL-1120 foreign-merge skip
  stay. Source: human Cursor 2026-08-25 prioritize; intake
  backlog/INTAKE-bl1135-residual-rematch-bookkeeping-deadlock.md.

  Background:
    Given a master checkout whose local main is ahead with bookkeeping commits
    And origin/main has advanced with a QA land that overlaps bookkeeping paths

  # BL-1138 rematch-bookkeeping-recovers-behind-zero-01
  Scenario: rematch-bookkeeping recovers to behind=0 without human absorb
    Given absorb-dispatch-plan chooses replay-bookkeeping
    When the automated master absorb path runs
    Then rematch or replay brings local main to behind 0 against origin/main
    And coordinator sync action is proceed or ff-only
    And no Complete-origin/main-merge or human conflict-resolution commit was required

  # BL-1138 recovery-clears-deadlock-tripped-02
  Scenario: successful rematch-bookkeeping recovery clears deadlock-tripped
    Given main-sync-deadlock is active with reason rematch-bookkeeping
    And absorb-dispatch-plan chooses replay-bookkeeping
    When rematch or replay succeeds so behind is 0
    Then main-sync-deadlock is cleared
    And main_sync_status_cli reports ready with action proceed or ff-only
    And the action is not deadlock-tripped

  # BL-1138 rematch-bookkeeping-not-durable-deadlock-03
  Scenario: rematch-bookkeeping is not designed to end as durable deadlock-tripped
    Given absorb would content-conflict or require bookkeeping replay
    When the automated absorb path runs across consecutive reconcile ticks
    Then the designed recovery is rematch lander or rematch bookkeeping owner
    And the surface does not page an operator to finish a conflicted absorb merge
    And standing deadlock-tripped waiting for Cursor is not the designed end state

  # BL-1138 merge-head-and-foreign-merge-hold-04
  Scenario: BL-1130 and BL-1120 hold under rematch-bookkeeping recovery
    Given rematch-bookkeeping recovery runs on the absorb path
    When the tick completes
    Then the checkout has no MERGE_HEAD left for an editor
    And a pre-existing foreign MERGE_HEAD is not aborted by this tick
