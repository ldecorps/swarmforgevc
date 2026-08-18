Feature: a byte-identical hot-synced copy never blocks a worktree merge

  # BL-924 (swarm-reliability). sync_worktree_scripts() cp -R's helper scripts
  # into every worktree at launch, leaving them UNTRACKED. git refuses a merge
  # that would overwrite an untracked file — even when the untracked copy is
  # byte-identical to the tracked version being merged in, so the merge could
  # not lose a single byte. Measured 2026-07-25: fast-forwarding swarmforge-QA
  # to main failed twice, naming only the first collisions each time, so the
  # operator cleared them by hand one round at a time.
  #
  # Split from BL-640, which found this while hand-repairing a stale worktree.
  # The two are independent: BL-640's remedy may refuse and report instead of
  # merging, so it does not wait on this. This slice is about the merge path.
  #
  # Step handlers: specs/pipeline/steps/bl924HotSyncedCopiesDoNotBlockMergeSteps.js,
  # driving the worktree merge path against fixture repos. The <copy> column is
  # validated against explicit KNOWN_VALUES, never passed through.

  Background:
    Given a role worktree carrying untracked hot-synced copies of paths that main tracks

  # BL-924 identical-copy-does-not-block-01
  Scenario Outline: a merge is blocked only when a copy would actually lose content
    Given an untracked copy whose content is <copy> the tracked version on main
    When that worktree merges main
    Then the merge <outcome>

    Examples:
      | copy              | outcome                              |
      | identical to      | completes without manual clearing    |
      | different from    | is refused rather than overwriting it |

  # BL-924 every-collision-reported-at-once-02
  Scenario: a genuine collision names every colliding path in one report
    Given several untracked copies differ from the tracked versions on main
    When that worktree merges main
    Then the refusal names every colliding path at once, not the first one only

  # BL-924 no-untracked-content-is-destroyed-03
  Scenario: clearing a collision never destroys content that exists nowhere else
    Given an untracked file in the worktree whose content is on no branch
    When that worktree merges main
    Then that file is left in place untouched
