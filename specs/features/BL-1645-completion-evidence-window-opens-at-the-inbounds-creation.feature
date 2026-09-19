Feature: BL-1645 A completion gate's evidence window opens when the inbound was created, not when it was dequeued

  The Work-note gate and the forward gate count a commit or handoff naming
  the ticket only after the inbound's dequeue stamp. On 2026-09-19 the coder
  built and forwarded BL-1637 before its first successful dequeue of the
  Work note (a drift refusal had blocked the first attempt), then dequeued
  it behind two older in_process items: plain completion found nothing
  since the stamp, a stated reason was refused because the ticket is active
  on main while in flight downstream, and the seat was blocked. After this
  parcel the window opens at the inbound's own creation: evidence produced
  after the dispatch existed counts however the dequeue was stamped, and
  evidence older than the dispatch never does. Every clause of the four
  decision tables is unchanged.

  Background:
    Given a fixture repository with a coder worktree and mailbox, an architect worktree and mailbox, and a fixture ticket BL-4242 active on main and assigned to coder

  # BL-1645 work-between-dispatch-and-dequeue-completes-plainly-01
  Scenario: a Work note whose work happened after it was created but before it was dequeued completes plainly
    Given a Work note for BL-4242 created at 10:00 and dequeued at 12:00
    And a commit whose subject leads with BL-4242 on the coder's branch at 11:00
    When the coder runs done_with_current with no reason
    Then the note is completed with no no_work_reason header on the completed file

  # BL-1645 a-forward-between-dispatch-and-dequeue-completes-plainly-02
  Scenario: a forwarding git_handoff whose forward was queued after it was created but before it was dequeued completes plainly
    Given a forwarding git_handoff for BL-4242 to the architect created at 10:00 and dequeued at 12:00
    And a git_handoff naming BL-4242 created at 11:00 sits in the architect's sent mailbox
    When the architect runs done_with_current with no reason
    Then the parcel is completed with no no_op_reason header on the completed file

  # BL-1645 evidence-older-than-the-dispatch-never-counts-03
  Scenario Outline: evidence produced before the inbound existed never completes it
    Given <inbound> created at 10:00 and dequeued at 12:00
    And <evidence> at 09:00
    When the <role> runs done_with_current with no reason
    Then the completion is refused naming BL-4242 with nothing moved

    Examples:
      | role      | inbound                                      | evidence                                                            |
      | coder     | a Work note for BL-4242                      | a commit whose subject leads with BL-4242 on the coder's branch     |
      | architect | a forwarding git_handoff for BL-4242         | a git_handoff naming BL-4242 in the architect's sent mailbox        |

  # BL-1645 the-active-on-main-clause-still-holds-04
  Scenario: a stated reason on a ticket active on main with no evidence since the dispatch is still refused
    Given a Work note for BL-4242 created at 10:00 and dequeued at 12:00
    And no commit or git_handoff naming BL-4242 since 10:00
    When the coder runs done_with_current with the reason not promoted yet
    Then the completion is refused naming BL-4242 as active on main with nothing moved

  # BL-1645 one-window-reader-for-every-gate-05
  Scenario: the three gate call sites read the window start through one shared function
    When done_with_current_task.bb, done_with_current_batch.bb and forward_evidence_lib.bb are inspected
    Then each gate call site takes its since bound from the same reader
    And that reader prefers created_at, then enqueued_at, then dequeued_at
