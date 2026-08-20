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
