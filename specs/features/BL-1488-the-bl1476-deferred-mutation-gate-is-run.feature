Feature: BL-1488 The Stryker mutation gate deferred on BL-1476 is run and discharged

  BL-1476 landed on 2026-09-08 with its Stryker mutation gate deferred: the
  cooldown gate refused transcriptWalker.ts, turnProfileProducer.ts and
  run-turn-profile-producer.ts at 2.95-2.97 of 3 days since BL-1364's touch,
  the hardener recorded the deferral with the ledger's defer verb rather
  than waving it through, and the land re-touched all three files. With
  BL-1476 closed the row names no open ticket, so the register reads it as
  an unowned red and the intake throttle holds. This ticket owns the row
  while the cooldown runs (until 2026-09-11) and discharges it with a
  completed run. Both scenarios read the parcel's own committed ledger,
  evidence and register, the contract at this commit.

  # BL-1488 the-bl1476-row-is-discharged-and-its-register-row-gone-01
  Scenario: the BL-1476 ledger row is discharged and the register holds no hardening row for its file set
    When the parcel's own hardening-debt ledger and standing-red register are read for BL-1476
    Then the BL-1476 mutation row carries a discharged_at date and a discharged_evidence path
    And the register report holds no hardening lane row naming BL-1488

  # BL-1488 the-run-completed-with-no-unexplained-survivor-02
  Scenario: the discharge evidence records a completed run over the three files
    When the discharge evidence for the mutation gate of BL-1476 is read
    Then it records a completed Stryker run over transcriptWalker, turnProfileProducer and run-turn-profile-producer with zero surviving mutants or a reason per survivor
    And it records the host load and the duration of that run
