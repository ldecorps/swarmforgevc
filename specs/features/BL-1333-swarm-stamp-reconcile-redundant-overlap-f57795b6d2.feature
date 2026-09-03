# mutation-stamp: sha256=d325e559bcf8e34eea04f044e884b7c5e733b4fc194809abb6edf648ebfa68e5
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-03T02:26:26.014894572Z","feature_name":"Stamp-off review of the reconcile redundant-overlap hotfix","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1333-swarm-stamp-reconcile-redundant-overlap-f57795b6d2.feature","background_hash":"3a71be9fddac987783f21ee8976cb8fc9bb8c5dafd190f9128f122ddc9edcb49","implementation_hash":"unknown","scenarios":[{"index":1,"name":"A path is dropped only when its content already matches origin/main","scenario_hash":"8e1771fb1d80acae745f12f8759244b5c7d3b012fbde77b307a0f46c85729058","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-03T02:26:26.014894572Z"}]}
# acceptance-mutation-manifest-end

Feature: Stamp-off review of the reconcile redundant-overlap hotfix

  BL-848 review-only certification of landed commits f57795b6d2 (handoffd.bb
  wiring) and d5739d84cc (the pure decision half in
  master_main_reconcile_lib.bb). These scenarios confirm or refute what
  landed; none of them may rewrite it, and none of them writes a certify or
  waive decision into backlog/hotfix-ledger.yaml - only a recorded human
  decision does that.

  The hotfix lets the reconcile daemon discard working-tree paths unattended,
  so the scenarios below are weighted toward the two things that bound that
  authority: the proof is read-only, and an unproven path is untouched.

  Background:
    Given the reconcile is blocked by a dirty overlap between the master checkout and origin/main

  # BL-1333 swarm-stamp-reconcile-redundant-overlap-01
  Scenario: The proof writes nothing
    When the redundancy proof runs against the overlapping paths
    Then the working tree is byte-identical to what it was before the proof ran

  # BL-1333 swarm-stamp-reconcile-redundant-overlap-02
  Scenario Outline: A path is dropped only when its content already matches origin/main
    Given an overlapping path whose working-tree content "<relation>" origin/main's content at that path
    When the reconcile sweep runs
    Then that path is "<outcome>"

    Examples:
      | relation       | outcome                    |
      | matches        | dropped and no longer blocks |
      | differs        | left as found and still blocks |

  # BL-1333 swarm-stamp-reconcile-redundant-overlap-03
  Scenario: An unproven path keeps the reconcile blocked and is named in the alert
    Given an overlapping path whose redundancy cannot be established
    When the reconcile sweep runs
    Then the reconcile is still blocked
    And the main-sync deadlock alert names that path and no path that was dropped

  # BL-1333 swarm-stamp-reconcile-redundant-overlap-04
  Scenario: Dirt outside the overlap is never touched
    Given uncommitted work on a path the incoming merge does not carry
    When the reconcile sweep runs
    Then that path retains its uncommitted content unchanged

  # BL-1333 swarm-stamp-reconcile-redundant-overlap-05
  Scenario: The drop set is recomputed immediately before the merge
    Given a redundancy proof computed earlier in the same sweep
    And one of its paths has since stopped matching origin/main
    When the reconcile performs the real merge
    Then the stale proof is not reused
    And that path is left as found and still blocks

  # BL-1333 swarm-stamp-reconcile-redundant-overlap-06
  Scenario: Local history survives a reconcile that dropped a redundant path
    Given an overlapping path the proof established as redundant
    When the reconcile sweep runs
    Then the merge completes
    And every local-only commit is still reachable

  # BL-1333 swarm-stamp-reconcile-redundant-overlap-07
  Scenario: The stamp leaves the certification decision to the human
    When the review parcel completes
    Then both ledger rows for the reviewed commits still read "pending"
