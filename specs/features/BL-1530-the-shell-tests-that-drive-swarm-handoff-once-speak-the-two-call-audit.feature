Feature: BL-1530 The shell tests that drive swarm_handoff once speak the two-call audit

  Since the AUDIT_REQUIRED landing of 2026-08-30, swarm_handoff.sh answers
  the first invocation of a git_handoff draft with HANDOFF_NOT_QUEUED and
  queues on the identical second call. Three standing shell tests send
  once and assert a queue, and have been red on main since. This feature
  is that each of them makes the protocol's second call, pins the first
  call where the case is about the send, and reaches the queue without
  any bypass of the audit.

  # BL-1530 shell-tests-speak-the-audit-01
  Scenario Outline: a standing shell test is green on the tree as it stands
    When swarmforge/scripts/test/<file> runs
    Then it prints ALL PASS and exits zero

    Examples:
      | file                                              |
      | test_rule_proposal.sh                             |
      | test_handoff_state_dir_worktree_root.sh           |
      | test_required_stages_ticket_lookup_collision.sh   |

  # BL-1530 shell-tests-speak-the-audit-02
  Scenario: the send-focused case pins the challenge rather than papering over it
    When swarmforge/scripts/test/test_rule_proposal.sh runs
    Then its git_handoff case asserts that the first call printed AUDIT_REQUIRED and queued nothing
    And its git_handoff case asserts the mailbox-only queue grammar on the second identical call

  # BL-1530 shell-tests-speak-the-audit-03
  Scenario: no test reaches the queue by bypassing the audit
    When swarmforge/scripts/swarm_handoff.bb on the tree as it stands is compared with main
    Then it is unchanged
    And none of the three test files sets an environment variable that swarm_handoff.bb reads to skip the audit

  # BL-1530 shell-tests-speak-the-audit-04
  Scenario: the drain wait in the control-character case is bounded on delivery evidence
    When swarmforge/scripts/test/test_rule_proposal.sh runs
    Then its control-character case waits on the daemon's delivery evidence with a deadline of at least ten seconds
    And it passes five consecutive runs

  # BL-1530 shell-tests-speak-the-audit-05
  Scenario: the census of git_handoff-sending shell tests is the one the ticket counted
    When every shell test under swarmforge/scripts/test that invokes swarm_handoff and drafts a git_handoff is listed
    Then the list names test_rule_proposal.sh
    And the list has eleven entries
