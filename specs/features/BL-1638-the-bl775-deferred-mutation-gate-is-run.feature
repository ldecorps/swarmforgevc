Feature: BL-1638 The Stryker mutation gate deferred on BL-775 is run and discharged

  BL-775 landed on 2026-09-18 with its Stryker mutation gate deferred: the
  perTest dry run over the two compiled bridge files timed out twice at
  the five-minute ceiling under a load of 11 to 25 with swap in use, the
  hardender recorded the deferral with the ledger's defer verb rather
  than waving it through, and the land closed the parcel. With BL-775
  closed the row names no open ticket, so the register reads it as an
  unowned red and the intake throttle holds the cap at one. This ticket
  owns the row while the three-day cooldown runs (until 2026-09-21) and
  discharges it with a completed run whose every survivor has an owner.
  Both scenarios read the parcel's own committed ledger, evidence and
  register, the contract at this commit.

  # BL-1638 the-bl775-row-is-discharged-and-its-register-row-gone-01
  Scenario: the BL-775 ledger row is discharged and the register holds no hardening row for its file set
    When the parcel's own hardening-debt ledger and standing-red register are read for BL-775
    Then the BL-775 stryker-mutation row carries a discharged_at date and a discharged_evidence path
    And the register report holds no hardening lane row naming BL-1638

  # BL-1638 the-run-completed-with-every-survivor-owned-02
  Scenario: the discharge evidence records a completed run over the two files with every survivor owned
    When the discharge evidence for the stryker-mutation gate of BL-775 is read
    Then it records a completed Stryker run over bubbleLiveUiHtml and residentPaneLive with zero surviving mutants or, per survivor, killed in this pass, accepted equivalent with its proof, or first-run debt owned by a named ticket
    And it records the host load and the duration of that run
