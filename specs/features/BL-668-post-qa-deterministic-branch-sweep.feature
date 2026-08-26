Feature: post-QA deterministic branch sweep fast-forwards clean role branches

  # BL-668: After QA lands on main, a deterministic sweep fast-forwards every
  # CLEAN role branch to the landed commit — zero LLM merge-up turns for the
  # mechanical case. Dirty worktrees, in_process parcels, and non-ff branches
  # are surfaced to their roles with logged skip reasons. Never merge, rebase,
  # stash, or reset. Worktree paths from roles.tsv only.

  Background:
    Given a fixture repo with five pipeline role branches registered in roles.tsv
    And QA has landed an approved commit on main

  # BL-668 three-clean-ff-01
  Scenario: the sweep fast-forwards exactly the three clean fast-forwardable role branches
    Given three role worktrees are clean and their branches can fast-forward to the landed commit
    And one role worktree is dirty
    And one role branch is genuinely divergent from the landed commit
    When the post-QA deterministic branch sweep runs
    Then exactly those three clean branches fast-forward to the landed commit
    And the dirty and divergent roles are not touched by the sweep

  # BL-668 skip-reasons-logged-02
  Scenario: surfaced skips are logged with reconstructable reasons
    Given one role worktree is dirty and one role branch cannot fast-forward
    When the post-QA deterministic branch sweep runs
    Then the audit trail logs two surfaced skips naming each role and its skip reason
    And the merge-up story remains reconstructable from the log

  # BL-668 in-process-skip-03
  Scenario: a role holding in_process work is surfaced and not fast-forwarded
    Given a role worktree is clean and fast-forwardable
    And that role's inbox in_process holds a parcel
    When the post-QA deterministic branch sweep runs
    Then that role branch is not fast-forwarded
    And the skip reason names in_process work

  # BL-668 fast-forward-only-04
  Scenario: the sweep never merges rebases stashes or resets
    Given any mix of clean dirty divergent or in_process role states
    When the post-QA deterministic branch sweep runs
    Then the sweep performs only fast-forward updates on branches it settles
    And it never merges rebases stashes or hard-resets any worktree

  # BL-668 rerun-noop-05
  Scenario: a second sweep after a successful run is a no-op
    Given the post-QA deterministic branch sweep has already settled every clean branch
    When the post-QA deterministic branch sweep runs again
    Then no branch moves and no duplicate settle records are written
    And surfaced skip reasons from the first run remain the authoritative story
