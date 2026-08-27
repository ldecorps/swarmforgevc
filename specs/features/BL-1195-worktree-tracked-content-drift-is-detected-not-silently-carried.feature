Feature: a pipeline worktree's tracked content silently diverging from its own HEAD is detected, not silently carried forward

  # BL-1195 (epic swarm-reliability). 2026-08-27: the coder found
  # swarmforge/scripts/handoff_inject_lib.bb, handoffd.bb (BL-1191, done)
  # and briefing_email_lib.bb (BL-1184, active) reverted to pre-ticket
  # content in its own worktree, uncommitted, with no authoring commit
  # anywhere — the coder noticed, stashed it defensively, and did not
  # forward it. BL-373 (the "phantom revert" launcher cp mechanism) already
  # guards this exact file set via sync_worktree_scripts.bb's tracked-path
  # check, so that specific, already-fixed mechanism is not the cause here
  # (verified: swarmforge/scripts/ paths are git-tracked in every role
  # worktree and are therefore left to git, never overwritten, by the
  # current launcher). The mechanism this time is unknown — this ticket
  # does not assume one.
  #
  # This is the same symptom family as BL-1098 (a merge on main/origin/main
  # can silently carry a stale blob with no authoring commit) but a
  # DIFFERENT manifestation: uncommitted working-tree drift inside a single
  # role's own worktree, caught before any commit. Detection technique
  # differs accordingly (compare working tree to the worktree's own HEAD,
  # not ref-vs-ref).

  Background:
    Given a pipeline role worktree whose branch HEAD holds known-good content for a tracked path

  # BL-1195 tracked-drift-detected-at-session-start-01
  Scenario: A tracked file whose working-tree content differs from HEAD with no in-progress edit explaining it is flagged, not silently used
    Given a tracked file under the worktree differs from what its own HEAD commits
    And the role has no in-progress task whose work would explain that edit
    When the worktree integrity check runs
    Then it reports the drifted path and refuses to treat the worktree as clean
    And it instructs preserving the drifted content (stash), never discarding it

  # BL-1195 genuine-wip-not-flagged-02
  Scenario: A file the role is legitimately editing for its current task is not flagged
    Given a tracked file under the worktree differs from what its own HEAD commits
    And that edit belongs to the role's own in-progress task
    When the worktree integrity check runs
    Then it does not report that path as drift

  # BL-1195 clean-worktree-passes-03
  Scenario: A worktree matching its own HEAD passes without noise
    Given every tracked file under the worktree matches its own HEAD
    When the worktree integrity check runs
    Then it reports no drift
