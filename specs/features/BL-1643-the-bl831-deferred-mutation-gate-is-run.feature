Feature: BL-1643 The Stryker mutation gate deferred on BL-831 is run and discharged

  BL-831 landed on 2026-09-19 with its Stryker mutation gate deferred: the
  perTest dry run over the compiled Pipeline page module timed out at the
  five-minute ceiling under a load of 11 to 14 with twenty-one concurrent
  workers, the hardender substituted targeted hand coverage and recorded
  the deferral with the ledger's defer verb rather than waving it through,
  and the land closed the parcel. With BL-831 closed the row names no open
  ticket, so the register reads it as an unowned red and the intake
  throttle holds the cap at one. This ticket owns the row while the
  cooldown runs and discharges it with a completed run whose every survivor
  has an owner. Both scenarios read the parcel's own committed ledger,
  evidence and register, the contract at this commit.

  # BL-1643 the-bl831-row-is-discharged-and-its-register-row-gone-01
  Scenario: the BL-831 ledger row is discharged and the register holds no hardening row for its file
    When the parcel's own hardening-debt ledger and standing-red register are read for BL-831
    Then the BL-831 stryker-mutation row carries a discharged_at date and a discharged_evidence path
    And the register report holds no hardening lane row naming BL-1643

  # BL-1643 the-run-completed-with-every-survivor-owned-02
  Scenario: the discharge evidence records a completed run over the file with every survivor owned
    When the discharge evidence for the stryker-mutation gate of BL-831 is read
    Then it records a completed Stryker run over bubblePipelinePage with zero surviving mutants or, per survivor, killed in this pass, accepted equivalent with its proof, or first-run debt owned by a named ticket
    And it records the host load and the duration of that run
