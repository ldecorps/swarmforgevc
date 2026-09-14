Feature: BL-1567 The inbound non-forwarding test speaks the two-call audit

  Since the AUDIT_REQUIRED landing of 2026-08-30, swarm_handoff answers the
  first invocation of a git_handoff draft with HANDOFF_NOT_QUEUED and queues
  on the identical second call; since BL-1529 the first call exits non-zero.
  test_swarm_handoff_inbound_non_forwarding.sh sends once in its case 03
  and asserts exit 0, so it has been red on main since 2026-09-12 - and was
  green before only because the challenge exited before delivery. This
  feature is that the file makes the protocol's second call, queues
  mailbox-only, and reaches the queue without any bypass of the audit.

  # BL-1567 inbound-non-forwarding-two-call-01
  Scenario: the shell test is green on the tree as it stands
    When swarmforge/scripts/test/test_swarm_handoff_inbound_non_forwarding.sh runs
    Then it prints ALL PASS and exits zero

  # BL-1567 inbound-non-forwarding-two-call-02
  Scenario: the allowed-send case pins the challenge and queues on the second call
    When swarmforge/scripts/test/test_swarm_handoff_inbound_non_forwarding.sh runs
    Then its allowed-send case asserts that the first call printed AUDIT_REQUIRED and queued nothing
    And its allowed-send case asserts the mailbox-only queue grammar on the second identical call

  # BL-1567 inbound-non-forwarding-two-call-03
  Scenario: the queueing send rides mailbox-only delivery, never a disabled daemon
    When the file swarmforge/scripts/test/test_swarm_handoff_inbound_non_forwarding.sh is read
    Then its queueing send exports SWARMFORGE_MAILBOX_ONLY set to 1
    And its queueing send does not export SWARMFORGE_SKIP_DAEMON

  # BL-1567 inbound-non-forwarding-two-call-04
  Scenario: the test reaches the queue without bypassing the audit
    When swarmforge/scripts/swarm_handoff.bb on the tree as it stands is compared with main
    Then it is unchanged
    And the test file sets no environment variable that swarm_handoff.bb reads to skip the audit

  # BL-1567 inbound-non-forwarding-two-call-05
  Scenario: the census of git_handoff-sending shell tests is the one the ticket counted
    When every shell test under swarmforge/scripts/test that invokes swarm_handoff and drafts a git_handoff is listed
    Then the list names test_swarm_handoff_inbound_non_forwarding.sh
    And the list has twelve entries
