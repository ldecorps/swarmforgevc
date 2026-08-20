# mutation-stamp: sha256=c49d52d63a5b2471509e123edef5be48138c86406f3851006d557c698b6aa0b7
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-20T16:18:08.295707Z","feature_name":"BL-985 a role's command never runs in another role's worktree","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-985-drift-into-sibling-worktree-is-re-anchored.feature","background_hash":"3cbfc811feb5617d4a4160a351d0aac5959aa19a28e6dfb31a55345634b46a3a","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a command drifted into a sibling worktree is re-anchored before it runs","scenario_hash":"21a8525c0c901bba806e75af93bde1504c54c985d33659e89e1b499c3ad57cf5","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-20T16:18:08.295707Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-985 a role's command never runs in another role's worktree

  The heal wrapper re-anchors a drifted command only after it has already
  failed with "fatal: not a git repository". A sibling worktree IS a git
  repository, so drifting from the master checkout into .worktrees/<other>
  produces no such failure: every path exists, every git command succeeds,
  and the wrapper sees nothing to heal. The role then reads and writes the
  wrong branch silently.

  The guard therefore has to be proactive - decided from where the shell IS,
  before the command runs - and not inferred from whether the command failed.
  With no drift present, the command must still reach the shell byte-untouched,
  so that anchoring costs nothing on the overwhelmingly common path.

  Background:
    Given a role whose pinned worktree is the repository master checkout

  # BL-985 drift-into-sibling-worktree-is-re-anchored-01
  Scenario: a command drifted into a sibling worktree is re-anchored before it runs
    Given the shell's working directory has drifted to "<drifted_cwd>"
    And the command would succeed unchanged in that directory
    When the role runs a command through the heal wrapper
    Then the command executes with the pinned worktree as its working directory
    And the drifted directory contributes nothing to what the command reads or writes

    Examples:
      | drifted_cwd              |
      | .worktrees/documenter    |
      | .worktrees/architect     |

  # BL-985 drift-into-sibling-worktree-is-re-anchored-02
  Scenario: a command already at the pinned worktree is left byte-untouched
    Given the shell's working directory is the pinned worktree
    When the role runs a command through the heal wrapper
    Then the command reaches the shell byte-untouched

  # BL-985 drift-into-sibling-worktree-is-re-anchored-03
  Scenario: drift out of any repository is still healed as before
    Given the shell's working directory is outside any git repository
    When the role runs a command through the heal wrapper
    Then the command executes with the pinned worktree as its working directory

  # BL-985 drift-into-sibling-worktree-is-re-anchored-04
  Scenario: every segment of a multi-command original is re-anchored
    Given the shell's working directory has drifted to ".worktrees/documenter"
    When the role runs a multi-segment command through the heal wrapper
    Then every segment executes with the pinned worktree as its working directory
