Feature: BL-1548 The launcher audits a skipped start request

  start_handoff_daemon.sh keeps the ledger of every daemon start request at
  <root>/.swarmforge/daemon/daemon-start-audit.log, and its invocation line
  carries a SKIP_DAEMON= field. Until this feature the SWARMFORGE_SKIP_DAEMON=1
  branch exited before the ledger existed, so a skipped request left no line
  and the field could only ever read empty. This feature is that the launcher
  ledgers the request first and skips second - still starting nothing and
  still leaving a deliberate stopped marker alone - and that the drift wiring
  test can therefore observe the daemon's deferred drift-repair bounce as that
  line, with nothing started.

  # BL-1548 the-launcher-audits-a-skipped-start-request-01
  Scenario: a skipped start request is ledgered and starts nothing
    Given a fixture root with a freshness stopped marker for "handoffd" already in place
    When start_handoff_daemon.sh is invoked against the fixture root with SWARMFORGE_SKIP_DAEMON "1"
    Then the launcher exits zero and prints the skipping line
    And the fixture's daemon-start-audit.log carries exactly one invocation line naming the fixture root with SKIP_DAEMON reading "1"
    And the freshness stopped marker for "handoffd" still exists
    And no handoffd pid file, no handoffd.log and no process rooted in the fixture exist

  # BL-1548 the-launcher-audits-a-skipped-start-request-02
  Scenario: an unskipped start request still ledgers the invocation line before the operator env file lines
    Given a fixture root whose handoffd and supervisor scripts are inert stubs that exit zero
    When start_handoff_daemon.sh is invoked against the fixture root with SWARMFORGE_SKIP_DAEMON ""
    Then the fixture's daemon-start-audit.log carries exactly one invocation line naming the fixture root with SKIP_DAEMON reading ""
    And that invocation line precedes the operator env file line in the log

  # BL-1548 the-launcher-audits-a-skipped-start-request-03
  Scenario: the drift wiring test observes the daemon's deferred bounce as the audit line with nothing started
    Given the wiring test "swarmforge/scripts/test/test_handoffd_master_checkout_drift_wiring.sh" which boots the real handoffd.bb against a disposable repository
    When the standing suite runs "swarmforge/scripts/test/test_handoffd_master_checkout_drift_wiring.sh"
    Then the run exits zero and reports no failed check
    And the run reports exactly 5 passed cases
    And case "05" reports the launcher audit log naming the fixture root under SKIP_DAEMON=1 with nothing started
    And no process whose command line names a printed fixture root survives the run
