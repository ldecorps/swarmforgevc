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

  Three callers share this walk and all inherit the blind spot:
  land_step_lib.bb's replay, task_scope_gate_lib.bb's own send-time gate,
  and unregistered_test_gate_lib.bb via parcel-own-changed-paths, whose
  docstring states it must never answer this question differently.

  Found 2026-08-30 by QA landing BL-1272, whose only BL-1272-subject commit
  in the walk was the merge dde87ca41; the replay reported nothing to commit
  and escalated. Measured on a real merge: --first-parent yields 0 paths,
  -m yields 10, and `git diff <commit>^1 <commit>` yields 2 - so the
  invocation chosen decides the answer, and only the last is the commit's
  own first-parent change.

  Background:
    Given a walk that attributes a commit to the task being checked

  # BL-1297 a-merge-commits-own-paths-are-not-empty-01
  Scenario: A merge commit reports the paths it changed against its first parent
    Given the attributed commit is a merge that changed at least one path against its first parent
    When the commit's own changed paths are computed
    Then those paths are reported
    And the result is not empty

  # BL-1297 a-merge-commits-own-paths-are-not-empty-02
  Scenario: A merge commit carrying a foreign path is refused, not passed
    Given the attributed commit is a merge whose first-parent change touches a path belonging to another ticket
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
    When the commit's own changed paths are computed
    Then the paths reported are the same as before this change
