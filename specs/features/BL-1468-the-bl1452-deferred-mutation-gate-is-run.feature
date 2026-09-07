Feature: BL-1468 The Stryker mutation gate deferred on BL-1452 is run and discharged

  BL-1452 landed on 2026-09-07 with its Stryker mutation gate deferred:
  the hardener's dry run over out/tools/backlogTicketId.js timed out at
  Stryker's five-minute ceiling twice under host load of 6.7 to 9.7 on 20
  cores from concurrent swarm activity, and was recorded with the
  ledger's defer verb rather than waved through. The row names the three
  files the parcel touched. With BL-1452 closed the row names no open
  ticket, so the register reads it as an unowned red and the intake
  throttle holds. This ticket owns the row while the cooldown on those
  files runs (they were touched by the land itself, so
  mutation_cooldown_days 3 refuses them until 2026-09-10) and discharges
  it with a completed run. Both scenarios read the parcel's own committed
  ledger, evidence and register, the contract at this commit.

  # BL-1468 the-bl1452-row-is-discharged-and-its-register-row-gone-01
  Scenario: the BL-1452 ledger row is discharged and its hardening register row is gone
    When the parcel's own hardening-debt ledger and standing-red register are read
    Then the ledger row for parcel BL-1452, gate mutation, carries a discharged_at date and a discharged_evidence path
    And the register report holds no hardening lane row naming BL-1468

  # BL-1468 the-run-completed-with-no-unexplained-survivor-02
  Scenario: the discharge evidence records a completed run with no unexplained survivor
    When the discharge evidence for the mutation gate of BL-1452 is read
    Then it records a completed Stryker run over the three files with zero surviving mutants or a reason per survivor
    And it records the host load and the duration of the run
