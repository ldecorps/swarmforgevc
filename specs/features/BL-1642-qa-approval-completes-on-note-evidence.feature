Feature: BL-1642 A QA approval completes on note evidence without a no-op reason

  BL-1609's forward gate refuses a worktree role's forwarding git_handoff
  completion unless a git_handoff naming the ticket was queued since dequeue
  or a no-op reason is stated. QA is a worktree role whose forward is a note:
  it lands the approved commit itself, broadcasts merge-up notes and sends
  the coordinator a bookkeeping note, and never queues a git_handoff. So the
  gate refused every QA approval since it landed on 2026-09-17, and QA
  completed each with a no-op reason. After this parcel a note naming the
  ticket, queued by the QA stage after the dequeue, is completion evidence;
  every other role, the since-dequeue rule, the reason path and the
  refusal's no-side-effects contract are unchanged.

  Background:
    Given a fixture repository with QA, architect and documenter worktrees and master-resident specifier and coordinator rows, per BL-1609's fixture
    And each worktree carries its own mailbox with empty outbox and sent directories

  # BL-1642 qa-completion-depends-on-what-it-sent-01
  Scenario Outline: completion of a forwarding parcel held by <role> depends on what it has sent since dequeue and what it says
    Given the <role> holds <holding>, dequeued a minute ago
    And <evidence>
    When the <role> runs done_with_current <invocation>
    Then the outcome is <outcome>

    Examples:
      | role      | holding                                            | evidence                                                                                   | invocation     | outcome                                                                  |
      | QA        | a forwarding git_handoff for BL-4242 in in_process | a note to the coordinator naming BL-4242 created after the dequeue sits in its outbox      | with no reason | completed plainly, with no no_op_reason header on the completed file     |
      | QA        | a forwarding git_handoff for BL-4242 in in_process | a note to the documenter naming BL-4242 created after the dequeue sits in its sent mailbox | with no reason | completed plainly, with no no_op_reason header on the completed file     |
      | QA        | a forwarding git_handoff for BL-4242 in in_process | no note or git_handoff naming BL-4242 exists in its outbox or sent mailbox                 | with no reason | refused naming BL-4242 and the two ways out, with nothing moved          |
      | QA        | a forwarding git_handoff for BL-4242 in in_process | a note naming only BL-9999 created after the dequeue sits in its outbox                    | with no reason | refused naming BL-4242 and the two ways out, with nothing moved          |
      | QA        | a forwarding git_handoff for BL-4242 in in_process | a note to the coordinator naming BL-4242 created before the inbound itself was queued sits in its sent mailbox | with no reason | refused naming BL-4242 and the two ways out, with nothing moved |
      | QA        | a forwarding git_handoff for BL-4242 in in_process | no note or git_handoff naming BL-4242 exists in its outbox or sent mailbox                 | with a reason  | completed with the reason recorded on the completed file                 |
      | QA        | a non-forwarding git_handoff for BL-4242 in in_process | no note or git_handoff naming BL-4242 exists in its outbox or sent mailbox             | with no reason | completed plainly, with no no_op_reason header on the completed file     |
      | architect | a forwarding git_handoff for BL-4242 in in_process | a note to the coder naming BL-4242 created after the dequeue sits in its outbox            | with no reason | refused naming BL-4242 and the two ways out, with nothing moved          |

  # BL-1642 one-helper-decides-qa-ness-for-both-gates-02
  Scenario: the forward gate and the hold gate decide QA-ness through one shared seat-stage helper
    When done_with_current_task.bb, done_with_current_batch.bb and forward_evidence_lib.bb are inspected
    Then the forward gate and the BL-1566 hold gate call the same seat-stage helper to decide whether this seat is the QA stage
    And neither gate compares the raw role name to the literal "QA"
