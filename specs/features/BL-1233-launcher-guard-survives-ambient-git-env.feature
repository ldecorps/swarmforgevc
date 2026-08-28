Feature: the launcher's tracked-path guard cannot be blinded by an ambient git environment

  # BL-1233 (epic swarm-reliability). BL-373 stopped the launcher clobbering
  # git-tracked files in role worktrees. Its guard asks the destination
  # worktree which paths it tracks; an ambient GIT_DIR/GIT_WORK_TREE makes
  # that question answer for a different checkout, and the empty answer is
  # read as "tracks nothing" — so the guard copies over everything.

  Background:
    Given a swarm launch that syncs the swarm scripts into a role worktree

  # BL-1233 ambient-git-env-does-not-blind-the-guard-01
  Scenario: an ambient git environment does not turn the guard into a clobber
    Given an ambient git directory and work tree pointing at a different checkout
    And a script change on the role branch that main does not have
    When the swarm is launched
    Then the role worktree's tracked script paths are left to git
    And the role branch's script change survives the launch

  # BL-1233 untrustworthy-answer-fails-closed-02
  Scenario: an answer git resolved for the wrong checkout is refused, not trusted
    Given the tracked-path question resolves against a checkout other than the destination worktree
    When the swarm is launched
    Then no file is copied into that worktree
    And the launcher refuses loudly, naming the destination it asked about and the checkout git answered for

  # BL-1233 foreign-target-repo-still-served-03
  Scenario: a target repository that genuinely tracks no swarm scripts still receives them
    Given a target repository that does not git-track the swarm scripts
    And the tracked-path question resolves against that repository itself
    When the swarm is launched
    Then that worktree receives every swarm script
