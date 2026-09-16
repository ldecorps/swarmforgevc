Feature: BL-1613 The branch-claim guard test's fixture is a complete swarm root

  swarmforge/scripts/test/test_branch_claim_guard.sh (BL-529) asserts that
  a passing claim emits no warning on stderr. Its fixture writes a
  swarm-identity with a name and a mode only; BL-966 (2026-08-20) made
  the depth resolution read the identity's conf path and print a loud
  fallback to stderr when it is absent, and BL-1004 (2026-08-21) made the
  claim path read the pack conf on every claim. Since then scenario 01's
  first row has failed on that fallback line, unrecorded until the
  coder's run on 2026-09-16. This feature is that the fixture persists
  the identity the launcher would persist, with its conf path and the
  tracked conf it names, so a passing claim is silent again, that the
  test is green, and that the one shell test asserting a silent claim is
  pinned so the census cannot go stale.

  # BL-1613 the-branch-claim-guard-test-fixture-is-a-complete-swarm-root-01
  Scenario: the fixture's swarm-identity names its conf path and the conf exists
    When the source of swarmforge/scripts/test/test_branch_claim_guard.sh is read
    Then the fixture writes a swarm-identity carrying active_backlog_max_depth_conf_path
    And the fixture creates the tracked conf that path names before any claim runs

  # BL-1613 the-branch-claim-guard-test-fixture-is-a-complete-swarm-root-02
  Scenario: the branch-claim guard test passes
    When the branch-claim guard shell test is executed from the repository root
    Then it exits 0 with every case reported as PASS

  # BL-1613 the-branch-claim-guard-test-fixture-is-a-complete-swarm-root-03
  Scenario: exactly one shell test asserts a silent claim, and it is this one
    When the shell tests under swarmforge/scripts/test that drive the task claim path are scanned for an empty-stderr assertion
    Then exactly 1 such test is found and it is test_branch_claim_guard.sh
