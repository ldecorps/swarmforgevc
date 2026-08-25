# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T13:54:23.415675677Z","feature_name":"BL-1131 residual — live lands still must not ops-page operator absorb","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1135-bl1131-residual-live-land-no-operator-absorb.feature","background_hash":"e5cabbe1445e90d846f2157d8ea88aa2f6bd7e6f5dbe599823bf8fd0d4232941","implementation_hash":"unknown","scenarios":[],"outcome":"inapplicable"}
# acceptance-mutation-manifest-end

Feature: BL-1131 residual — live lands still must not ops-page operator absorb
  BL-1131 closed with rematch-then-FF policy in `master_main_reconcile_lib`
  (`absorb-dispatch-plan`, `post-land-absorb-plan`, `land-pipeline-outcome`)
  and handoffd cases `:replay-bookkeeping` / `:refuse-rematch`. Measured
  2026-08-25 after close: QA lands for BL-533 / BL-534 / BL-695 still left
  local main behind with reconcile `conflict` escalated and Operator
  "master main reconcile still conflict-blocked … needs a human"; recovery
  was again `Complete origin/main merge…` on the master checkout.
  Residual: wire the live QA land + absorb path so a successful land
  reaches behind=0 / proceed without that ops absorb, and conflict/race
  recovery is rematch lander or bookkeeping owner — never Cursor finishing
  a conflicted join. BL-1130 clean-refuse and BL-1120 foreign-merge skip
  stay. Source: human Cursor 2026-08-25 ("Well yes" to residual mint).

  Background:
    Given BL-1131 policy helpers exist on the absorb dispatch path
    And BL-1130 clean-refuse behaviour remains in force

  # BL-1135 residual-live-land-behind-zero-01
  Scenario: a live ticket land after BL-1131 reaches behind=0 without operator absorb
    Given local main is ahead of origin/main with overlapping ticket paths
    And a ticket tip publishes to origin/main through the live QA land path
    When the automated master absorb path runs
    Then behind is 0
    And coordinator sync action is proceed
    And no Complete-origin/main-merge or human conflict-resolution commit was required

  # BL-1135 residual-no-human-conflict-blocked-page-02
  Scenario: conflict foresight does not escalate as needs-a-human absorb
    Given local main is ahead and absorb would content-conflict
    When the automated absorb path runs
    Then the designed recovery is rematch lander or rematch bookkeeping owner
    And the surface does not page an operator to finish a conflicted absorb merge
    And the checkout has no MERGE_HEAD left for an editor

  # BL-1135 residual-replay-bookkeeping-is-live-03
  Scenario: replay-bookkeeping is executed or rematched — not left as wait-dirty-clear
    Given absorb-dispatch-plan returns replay-bookkeeping
    When the live absorb runner handles that plan
    Then bookkeeping is replayed onto the new tip or rematch is surfaced to its owner
    And main_sync_status is not left wait-dirty-clear pending an operator merge

  # BL-1135 residual-bl1130-bl1120-preserved-04
  Scenario: BL-1130 and BL-1120 invariants still hold
    Given a predicted content conflict on automated absorb
    When the absorb path runs
    Then it refuses clean without leaving MERGE_HEAD
    And a pre-existing foreign MERGE_HEAD is not aborted by this tick
