Feature: BL-1612 The send-time gates see a batch role's received parcel

  BL-1313 made the sender's own non-forwarding check batch-aware, but the
  two readers that supply a sender's received commit to the send-time
  gates still read the in_process box flat: the review-forward reader in
  review_forward_evidence_gate_lib.bb, used by BL-806's review-forward
  evidence gate and BL-1576's merge-drop gate, and the rollback reader in
  parcel_rollback_guard_lib.bb, used by BL-1213's parcel-rollback gate. A
  cleaner or hardender holds its parcels inside batch directories, so for
  those two roles all three gates find no received commit and, by their
  documented fail-open posture, stay silent on every send. This feature
  is that both readers descend into batch directories, so a batch-held
  git_handoff's commit is the received commit each gate judges, a task
  role's is unchanged, an emptied batch directory yields nothing, and the
  rollback gate then refuses a batch role exactly as it refuses a task
  role.

  Background:
    Given a fixture swarm root whose roles table declares architect as a task role and cleaner as a batch role, each with its own worktree and mailbox

  # BL-1612 the-send-time-gates-see-a-batch-roles-received-parcel-01
  Scenario Outline: the received commit a reader returns follows where the parcel is held
    Given the <role>'s in_process box holds <holding>
    When <reader> resolves the received commit for that task
    Then it returns <result>

    Examples:
      | role      | holding                                                                 | reader                    | result     |
      | cleaner   | a batch directory with a git_handoff for the task at commit abc1234567  | the review-forward reader | abc1234567 |
      | cleaner   | a batch directory with a git_handoff for the task at commit abc1234567  | the rollback reader       | abc1234567 |
      | cleaner   | an emptied batch directory                                              | the review-forward reader | nothing    |
      | architect | a git_handoff for the task at commit abc1234567 at the top level         | the rollback reader       | abc1234567 |
      | architect | nothing                                                                 | the review-forward reader | nothing    |

  # BL-1612 the-send-time-gates-see-a-batch-roles-received-parcel-02
  Scenario: a batch role's rollback of what it received is refused like a task role's
    Given the cleaner holds a batch with a git_handoff for BL-4242 whose commit is on the fixture's architect branch
    And the cleaner's forwarded commit does not descend from that received commit
    When the cleaner sends a git_handoff for BL-4242
    Then the send is refused by the parcel-rollback gate naming the received commit
