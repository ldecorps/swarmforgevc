Feature: BL-1805 Every QA turn retries a pending land re-point

  Hotfix 4183cd29ca makes a skipped post-land re-point arm
  .swarmforge/daemon/pending-land-repoint.json and retries it through
  land_step_cli try-repoint. land_step_lib's own docstring says the retry
  runs at the "done_with_current / ready_for_next idle boundaries", but only
  done_with_current_task.bb calls it. A pending re-point therefore waits for
  QA's next completion. A retry that skips again at that completion, or a
  QA seat woken, chased or respawned without completing, starts the next
  land walk on a QA branch that never re-pointed, which is the growth the
  hotfix exists to stop. QA's ready_for_next now retries at the top of
  every turn, beside the hold-status print BL-1566 already makes there.
  Every scenario runs against a fixture root, origin and QA worktree under
  mkdtemp (BL-1390).

  Background:
    Given a fixture swarm whose QA worktree has an armed pending land re-point and a clean tree
    And no role has new mail waiting

  # BL-1805 a-qa-turn-retries-the-pending-repoint-01
  Scenario: QA's ready_for_next retries the pending re-point before reporting no task
    When "QA" runs ready_for_next
    Then the pending land re-point is "cleared"
    And the QA branch points at origin/main
    And the output still ends with NO_TASK

  # BL-1805 a-resumed-parcel-keeps-the-repoint-pending-02
  Scenario: a QA turn that resumes an in_process parcel leaves the re-point pending
    Given a parcel sits in QA's in_process
    When "QA" runs ready_for_next
    Then the pending land re-point is "armed"
    And the QA branch has not moved

  # BL-1805 another-roles-turn-never-repoints-03
  Scenario: another role's ready_for_next never attempts the re-point
    When "coder" runs ready_for_next
    Then the pending land re-point is "armed"
    And the QA branch has not moved
