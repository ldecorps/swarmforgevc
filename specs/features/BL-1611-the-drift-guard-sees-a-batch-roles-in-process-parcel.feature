Feature: BL-1611 The worktree-drift guard sees a batch role's in-process parcel

  BL-1195's pre-turn guard refuses a turn when tracked files differ from
  the worktree's HEAD and the role holds no in-process parcel, because a
  role with nothing dequeued has no reason to have modified anything. It
  reads the role's in_process box with the flat file reader, which does
  not descend into the batch_ directories that batch roles (cleaner,
  hardender) hold their parcels in, so a batch role mid-work reads as
  holding nothing and its own uncommitted edits are refused as drift. The
  hardender hit it at session start on BL-1599 on 2026-09-16. This feature
  is that the guard reads the in_process box with the batch-aware reader,
  so every roster shape is judged the way BL-1195 meant: a task role and
  a batch role with a parcel keep their edits, either with nothing
  dequeued is still refused, and a master-resident role stays exempt.

  Background:
    Given a fixture swarm root whose roles table declares architect as a task role with its own worktree, hardender as a batch role with its own worktree, and specifier as a master-resident row, each worktree with one tracked file

  # BL-1611 the-drift-guard-sees-a-batch-roles-in-process-parcel-01
  Scenario Outline: the guard's verdict follows the roster shape and whether a parcel is really held
    Given the <role> worktree's tracked file is modified against its HEAD
    And the <role>'s in_process box holds <holding>
    When the <role> runs ready_for_next
    Then the turn is <outcome>

    Examples:
      | role      | holding                                                   | outcome                                         |
      | hardender | a batch directory with one git_handoff parcel inside it   | not refused as drift                            |
      | hardender | nothing                                                   | refused as WORKTREE_DRIFT_DETECTED naming the file |
      | architect | one git_handoff parcel                                    | not refused as drift                            |
      | architect | nothing                                                   | refused as WORKTREE_DRIFT_DETECTED naming the file |
      | specifier | nothing                                                   | not refused as drift                            |

  # BL-1611 the-drift-guard-sees-a-batch-roles-in-process-parcel-02
  Scenario: the guard and the batch resume read the in_process box through one reader
    When the source of swarmforge/scripts/ready_for_next.bb is read
    Then the in-process check the drift guard uses reads the box through the batch-aware reader
    And no flat in_process read remains in that file
