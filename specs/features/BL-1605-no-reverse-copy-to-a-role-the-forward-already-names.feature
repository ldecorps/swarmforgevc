# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-16T21:56:22.157881717Z","feature_name":"BL-1605 No reverse copy to a role the forward already names","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1605-no-reverse-copy-to-a-role-the-forward-already-names.feature","background_hash":"1cc442e7760501e76f4e700c750c860cf065f58b5ba7580e73b8813611bd86a3","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: BL-1605 No reverse copy to a role the forward already names

  A git_handoff's reverse copies go to every earlier role the sender's
  pack mode declares, including the role the forward is already addressed
  to, so an architect bounce to the cleaner arrives twice in one batch and
  the merge-only twin makes the send gate refuse the cleaner's re-forward
  for the whole batch. This feature is that the reverse set excludes the
  forward's recipients, that forward hops' merge-only copies and the
  coordinator's exclusion are unchanged, and that the send gate's refusal
  for another task's merge-only inbound still stands.

  Background:
    Given a fixture swarm root whose roles table lists coder, cleaner, architect, hardender, documenter and QA, with the cleaner declared back-one and the architect back-all

  # BL-1605 no-reverse-copy-to-a-role-the-forward-already-names-01
  Scenario Outline: a role receives either the forwarding copy or a merge-only copy of one send, never both
    When <sender> queues a git_handoff to <recipient> through the real sender with the audit answered
    Then <recipient>'s mailbox holds exactly one file for the task and it carries no non-forwarding marker
    And the merge-only copies of that send go to <reverse-roles> and to no other role

    Examples:
      | sender    | recipient | reverse-roles     |
      | architect | cleaner   | coder             |
      | architect | hardender | cleaner and coder |
      | cleaner   | architect | coder             |
      | cleaner   | coder     | nobody            |

  # BL-1605 no-reverse-copy-to-a-role-the-forward-already-names-02
  Scenario: a merge-only inbound for another task still refuses the role's git_handoff while it is in process
    Given the cleaner holds in process a non-forwarding inbound for a different task
    When the cleaner tries to queue a git_handoff to architect for its own task
    Then the sender refuses because a non-forwarding inbound is in process
