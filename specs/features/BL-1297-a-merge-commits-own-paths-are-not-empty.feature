Feature: A merge commit's own changed paths are computed, not silently empty

  task_scope_gate_lib.bb's own-commit-diff asks what a commit changed with
  `git diff-tree --no-commit-id --name-only -r --first-parent <commit>`. For
  a MERGE commit git suppresses the diff entirely unless -m or -c/--cc is
  given, and --first-parent is a log/rev-list traversal flag with no effect
  on diff-tree's own output. So a merge commit yields no paths at all.

  That is the normal shape of a role's own commit: every stage does
  `git merge <hash>` to receive the handoff, then forwards. A parcel whose
  only task-tagged commit is that merge therefore reports an empty change
  set, and empty is read as no violation, so the check fails OPEN.

  Found 2026-08-30 by QA landing BL-1272, whose only BL-1272-subject commit
  in the walk was the merge dde87ca41; the replay reported nothing to commit
  and escalated.

  Two DIFFERENT questions share this walk, and the fix must keep them apart
  (amended 2026-08-30, after the first version of this contract blocked its
  own parcel - see the ticket's "Corrected" section):

    DELIVERED - "what content does this commit put on the branch?" The land
    step's replay asks this. For a merge that is everything the merge brought
    in: the first-parent delta.

    AUTHORED - "what did the person making this commit write?" The send-time
    scope gate and the unregistered-test gate ask this, because both judge
    the parcel's author. For a merge that is only what differs from EVERY
    parent - a conflict resolution or an evil merge - and it is empty for an
    ordinary clean receive-merge, whose content was authored upstream and is
    already attributed to the commits that made it.

  Measured on the hardener's own receive-merge d4e74ea3d1: 25 paths
  delivered, spanning 8 unrelated tickets that rode along on routine main
  syncs; 1 path authored, and that one is BL-1297's own test runner. Reading
  the delivered set as authored is what refused this ticket's own forward.

  Background:
    Given a walk that attributes a commit to the task being checked

  # BL-1297 a-merge-commits-own-paths-are-not-empty-01
  Scenario: A merge commit's delivered paths are computed, not empty
    Given the attributed commit is a merge that changed at least one path against its first parent
    When the commit's delivered paths are computed
    Then those paths are reported
    And the result is not empty

  # BL-1297 a-merge-commits-own-paths-are-not-empty-02
  # Amended: the foreign path must be one the MERGER wrote. A merge that
  # merely carries another ticket's already-landed work is scenario 05.
  Scenario: A merge that authors a foreign path is refused, not passed
    Given the attributed commit is a merge whose own resolution touches a path belonging to another ticket
    When the gate decides whether the handoff may be sent
    Then the handoff is refused
    And the refusal names the foreign path

  # BL-1297 a-merge-commits-own-paths-are-not-empty-03
  Scenario: A parcel whose only attributed commit is a merge still has content to replay
    Given the only commit attributed to the task in the walk is a merge
    When the land step computes what to replay
    Then it does not report that there is nothing to commit

  # BL-1297 a-merge-commits-own-paths-are-not-empty-04
  Scenario: A non-merge commit's reported paths are unchanged
    Given the attributed commit is an ordinary single-parent commit
    When the commit's delivered paths are computed
    Then the paths reported are the same as before this change

  # BL-1297 a-merge-commits-own-paths-are-not-empty-05
  # The regression the first version of this contract caused: every stage
  # receives its handoff by merge and syncs main routinely, so the delivered
  # set of an ordinary receive-merge names every ticket landed since the
  # branch last synced. Attributing those to the merger refuses every forward
  # in the pipeline.
  Scenario: A clean receive-merge carrying other tickets' landed work is not refused
    Given the attributed commit is a clean receive-merge whose delivered paths belong to other tickets
    And the merge resolved no path itself
    When the gate decides whether the handoff may be sent
    Then the handoff is not refused

  # BL-1297 a-merge-commits-own-paths-are-not-empty-06
  Scenario: The two questions agree wherever they can only have one answer
    Given the attributed commit is an ordinary single-parent commit
    When the commit's delivered paths and its authored paths are both computed
    Then the two answers are identical
