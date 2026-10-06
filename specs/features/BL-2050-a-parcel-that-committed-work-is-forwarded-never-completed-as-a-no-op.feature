Feature: BL-2050 A parcel that committed work is forwarded, never completed as a no-op

  On 2026-10-06 the coder seat finished two QA bounces, BL-1843 at 13:27Z
  and BL-2033 at 13:37Z, committed each fix, rewrote the stale root
  HANDOFF.md as its "handoff", and completed each bounce with
  done_with_current --no-op and a reason that described the work ("QA D1
  remediation complete ... commit 557fa56a98; handoff written"). No
  git_handoff was ever queued, so both finished fixes sat in no mailbox
  until the coordinator's sweep found them. BL-1609's forward gate let it:
  any non-blank --no-op reason completes a forwarding parcel, and its
  refusal names --no-op as one of the two ways out. After this parcel a
  role other than QA cannot complete a forwarding git_handoff as a no-op
  once it has committed for that ticket since the parcel was queued: the
  refusal names the commit and the git_handoff to send. QA keeps its
  reason path, because a QA pass commits evidence and completes a held
  parcel with a reason (QA.prompt, BL-1566).

  Background:
    Given a fixture swarm root whose roles table declares coder and QA as task roles with their own worktrees

  # BL-2050 committed-parcel-no-op-refused-01
  Scenario Outline: a no-op reason completes a forwarding parcel only when the role committed nothing for its ticket
    Given the <role> holds a forwarding git_handoff for BL-4242 in in_process, queued a minute ago, with no git_handoff naming BL-4242 in its outbox or sent mailbox
    And <commits> on the <role>'s branch since that parcel was queued
    When the <role> runs done_with_current with the reason work done, handoff written
    Then the outcome is <outcome>

    Examples:
      | role  | commits                                    | outcome                                                                         |
      | coder | a commit whose subject leads with BL-4242  | refused naming that commit and the git_handoff to send, with nothing moved     |
      | coder | no commit naming BL-4242                   | completed recording the reason work done, handoff written                       |
      | QA    | a commit whose subject leads with BL-4242  | completed recording the reason work done, handoff written                       |

  # BL-2050 committed-parcel-refusal-names-only-the-forward-02
  Scenario: the refusal for a parcel that committed work does not offer the no-op way out
    Given the coder holds a forwarding git_handoff for BL-4242 in in_process, queued a minute ago, with no git_handoff naming BL-4242 in its outbox or sent mailbox
    And a commit whose subject leads with BL-4242 on the coder's branch since that parcel was queued
    When the coder runs done_with_current with no reason
    Then it is refused naming that commit
    And the refusal does not mention --no-op
