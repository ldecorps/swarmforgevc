# mutation-stamp: sha256=23d5876ec00e6623575d4255471bf98c73612bacdb124d72b3612f52d2a27126
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T10:55:56.366905290Z","feature_name":"BL-1118 post-Cursor-batch merge of origin/main (process B)","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1118-post-cursor-batch-merge-origin-main.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"post-hotfix helper fetches origin/main then merges or aborts","scenario_hash":"5e71cd675f5d6a6fa52c691923934c118492eac59ce162ba8d5f25677ce8fb4f","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-25T10:19:37.224314002Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1118 post-Cursor-batch merge of origin/main (process B)
  After every Cursor/operator batch that advances local main, immediately
  attempt to merge origin/main under BL-891 invariants. Keep
  SWARMFORGE_ROLE=QA as the supported hotfix land path. Do not replace
  that path with another exemption.

  # BL-1118 helper-outcome-01
  Scenario Outline: post-hotfix helper fetches origin/main then merges or aborts
    Given local main is clean and behind origin/main by at least one commit
    And the merge of origin/main is <mergeability>
    When the post_hotfix_merge_origin helper runs
    Then the helper outcome is "<outcome>"
    And the helper exit code is <exit>

    Examples:
      | mergeability     | outcome                                                  | exit |
      | conflict-free    | fetches and merges origin/main                           | 0    |
      | path-conflicting | aborts the merge, prints conflicted paths, not mid-merge | 1    |

  # BL-1118 docs-keep-qa-role-02
  Scenario: operator how-to keeps QA role and names the post-batch merge step
    Given the BL-848 or BL-891 operator how-to updated by this slice
    When an operator reads the post-batch checklist
    Then the checklist still requires SWARMFORGE_ROLE=QA for pipeline-path hotfix lands on main
    And the checklist tells the operator to run the post-batch merge helper before ending the session

  # BL-1118 deadlock-reason-honest-when-clean-behind-03
  Scenario: a clean behind tip does not keep a stale dirty deadlock reason
    Given local main is clean and behind origin/main by at least one commit
    And a stale deadlock marker still names a dirty reason
    When sync status is refreshed after the helper path
    Then the reported sync action is wait-reconcile or conflict-shaped
    And it is not left stuck on the stale dirty deadlock reason
