Feature: a constitution reference amendment reaches every role before it next acts

  # BL-640: articles/*.prompt are inlined into the composed system prompt, so
  # regenerating it plus a respawn delivers an amendment there. articles/
  # reference/*.prompt is read from each role's OWN worktree on demand and is
  # NOT inlined — an amendment landed on main via that path reached zero role
  # worktrees, leaving three branches carrying a stale elaboration that
  # directly contradicted the amended, inlined rule. A second, independent
  # defect: fast-forwarding a role branch to main can fail on untracked
  # hot-synced files that are byte-identical to main's tracked versions.

  # BL-640 amendment-reaches-role-before-next-act-01
  Scenario: an amended reference/ file reaches a role before it next acts on the amended subject
    Given a constitution reference/ file is amended on main
    When a role is about to act on the subject that file elaborates
    Then that role reads the amended text, not a stale copy

  # BL-640 stale-read-without-merge-is-caught-02
  Scenario: a role that has not merged main never silently acts on stale reference text
    Given a constitution reference/ file was amended on main
    And a role's worktree has not merged main since
    When that role reads the reference/ file for the amended subject
    Then the role either sees the amended text or refuses and reports the staleness

  # BL-640 inlined-and-elaboration-never-contradict-03
  Scenario: an inlined rule and its on-demand elaboration never contradict each other
    Given the 2026-07-25 bounce-revert amendment pair (inlined: verify content is gone; stale elaboration: verify ancestry is FALSE)
    When a role reads both its inlined prompt and the reference/ elaboration for that rule
    Then the two never instruct contradictory verification steps

  # BL-640 no-steady-state-prompt-growth-04
  Scenario: the composed prompt does not grow in size when nothing has changed
    Given no constitution file has changed since the last composed prompt
    When the prompt is composed again
    Then its byte size matches the prior baseline

  # BL-640 identical-untracked-copy-does-not-block-fast-forward-05
  Scenario: a byte-identical untracked hot-synced file does not block a fast-forward merge
    Given a role worktree carries untracked files that are byte-identical to main's tracked versions of the same paths
    When that worktree fast-forwards to main
    Then the merge is not blocked by those files
    And any remaining genuine collision is reported naming every colliding path at once, not one round at a time

  # BL-640 top-level-articles-unchanged-06
  Scenario: top-level articles/*.prompt delivery is unchanged
    Given a top-level articles/*.prompt file is amended on main
    When the composed prompt is regenerated and a role respawns
    Then the amended top-level rule is present in that role's inlined prompt
