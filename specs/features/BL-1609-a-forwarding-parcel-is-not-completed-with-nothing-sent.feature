Feature: BL-1609 A forwarding parcel is not completed with nothing sent

  On 2026-09-16 the architect received the cleaner's re-forward of a fixed
  bounce twice (BL-1595 at 17:37Z, BL-1547 at 17:41Z) and completed each
  inbound within fourteen seconds of dequeue, with no merge in its reflog,
  no review evidence and no forward; both parcels sat in no mailbox until
  the coordinator's dropped-parcel sweep chased the architect fifty-eight
  and seventy-nine minutes later. The completion helper let it: BL-1422's
  evidence gate covers Work notes only, so a forwarding git_handoff can be
  completed with nothing sent, on the task path and the batch path alike.
  This feature is that a code-worktree role's forwarding git_handoff
  inbound, held alone or inside a batch, completes only when a git_handoff
  for its ticket was queued after the inbound ITSELF was queued (BL-1645:
  its own created_at, not its dequeue stamp) or a no-op reason is stated
  and recorded on the completed file, that a refusal moves nothing, and
  that a merge-only inbound and a master-resident role complete exactly as
  today. The live chain is QA's e2e.

  Background:
    Given a fixture swarm root whose roles table declares architect as a task role with its own worktree, cleaner as a batch role with its own worktree, and specifier and coordinator as master-resident rows sharing one checkout

  # BL-1609 a-forwarding-parcel-is-not-completed-with-nothing-sent-01
  Scenario Outline: completion of a parcel depends on what the role holds, what it has sent, and what it says
    Given the <role> holds <holding>, dequeued a minute ago
    And <evidence>
    When the <role> runs done_with_current <invocation>
    Then the outcome is <outcome>

    Examples:
      | role      | holding                                                                                    | evidence                                                                          | invocation                                 | outcome                                                                  |
      | architect | a forwarding git_handoff for BL-4242 in in_process                                         | no git_handoff naming BL-4242 exists in its outbox or sent mailbox                | with no reason                             | refused naming BL-4242 and the two ways out, with nothing moved          |
      | architect | a forwarding git_handoff for BL-4242 in in_process                                         | a git_handoff naming BL-4242 created after the dequeue sits in its outbox         | with no reason                             | completed with no completion reason recorded                             |
      | architect | a forwarding git_handoff for BL-4242 in in_process                                         | a git_handoff naming BL-4242 created after the dequeue sits in its sent mailbox   | with no reason                             | completed with no completion reason recorded                             |
      | architect | a forwarding git_handoff for BL-4242 in in_process                                         | no git_handoff naming BL-4242 exists in its outbox or sent mailbox                | with the reason no-op evidence-only rebase | completed recording the reason no-op evidence-only rebase                |
      | architect | a non-forwarding git_handoff for BL-4242 in in_process                                     | no git_handoff naming BL-4242 exists in its outbox or sent mailbox                | with no reason                             | completed with no completion reason recorded                             |
      | specifier | a forwarding git_handoff for BL-4242 in in_process                                         | no git_handoff naming BL-4242 exists in its outbox or sent mailbox                | with no reason                             | completed with no completion reason recorded                             |
      | cleaner   | a batch holding a forwarding git_handoff for BL-4242 and a non-forwarding twin of its commit | no git_handoff naming BL-4242 exists in its outbox or sent mailbox               | with no reason                             | refused naming BL-4242 and the two ways out, with nothing moved          |
      | cleaner   | a batch holding a forwarding git_handoff for BL-4242 and a non-forwarding twin of its commit | a git_handoff naming BL-4242 created after the dequeue sits in its outbox        | with no reason                             | completed with no completion reason recorded                             |
