Feature: BL-1543 The drift wiring test asserts the daemon's live repair contract

  test_handoffd_master_checkout_drift_wiring.sh (BL-839) boots the real
  handoffd.bb against a disposable repository and is the only end-to-end proof
  that the daemon fires the master-checkout-drift sweep. It has been red since
  2026-08-25: BL-1139 made the sweep restore durable drift from main and emit
  one RESTORED note instead of a WARN, and the test still asserts the
  detect-only world (first MASTER CHECKOUT DRIFT line says "not the code", file
  left modified). This feature is that the test is green against the real
  daemon, proving the restored branch and the in-flight WARN branch, and that
  it leaves no process behind. Proving the deferred bounce REACHED the
  launcher is BL-1548's own scenario (case "05" of this same shared suite,
  added once the launcher started ledgering a skipped invocation before
  honouring it) - this feature only asserts that a fifth passed case now
  exists, never its content (amended 2026-09-12; the mint's own case 05
  asserted a line that did not exist yet, before BL-1548 landed).

  Background:
    Given the wiring test "swarmforge/scripts/test/test_handoffd_master_checkout_drift_wiring.sh" which boots the real handoffd.bb against a disposable repository

  # BL-1543 the-drift-wiring-test-asserts-the-daemons-live-repair-contract-01
  Scenario: the wiring test is green against the real daemon and proves the repair contract end to end
    When the standing suite runs "swarmforge/scripts/test/test_handoffd_master_checkout_drift_wiring.sh"
    Then the run exits zero and reports no failed check
    And the run reports exactly 5 passed cases
    And case "01" reports the OPERATOR outbox carrying one "MASTER CHECKOUT DRIFT RESTORED:" line naming "swarmforge/scripts/handoffd_supervisor.bb"
    And case "02" reports the drifted script matching main after the sweep
    And case "03" reports no "MASTER CHECKOUT DRIFT:" warning line for the restored episode
    And case "04" reports a warning stating the running code is not the landed code while ".git/index.lock" is present, with the script left modified

  # BL-1543 the-drift-wiring-test-asserts-the-daemons-live-repair-contract-02
  Scenario: the wiring test leaves no process rooted in its fixture behind
    When the standing suite runs "swarmforge/scripts/test/test_handoffd_master_checkout_drift_wiring.sh"
    Then no process whose command line names a printed fixture root survives the run
    And no printed fixture root still exists on disk
