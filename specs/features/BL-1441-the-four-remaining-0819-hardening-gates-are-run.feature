Feature: BL-1441 The four hardening gates BL-1439 could not run are run and discharged

  BL-1439 gave the hardening-debt ledger its discharge verb and ran the
  one 2026-08-19 gate the host allowed: the gherkin-mutation run on
  BL-956's feature. The other four, Stryker mutation on BL-620's,
  BL-955's and BL-954's file sets and on pipelineBoard.ts, were blocked
  and recorded as attempts: three because BL-1425 had touched
  telegramFrontDeskBotCore.ts and pipelineBoard.ts on 2026-09-05 and the
  cooldown gate (mutation_cooldown_days 3) rightly refuses a file that
  fresh, one because the constitution-citation red (BL-1440) stops every
  Stryker dry run. Their register rows name this ticket so the debt stays
  owned while it waits. The cooldown clears on 2026-09-08.

  This feature is that each of the four runs completes and is discharged
  with evidence, and that the register's hardening lane then holds no row
  naming BL-1441. Rows other tickets own (BL-1468 and BL-1488, deferred
  after this ticket was minted) are theirs to discharge, not this
  ticket's. Both scenarios read the parcel's own committed ledger,
  evidence and register, a read-only live-tree read justified because
  they are the contract at this commit.

  # BL-1441 every-remaining-0819-row-is-discharged-01
  # Amended 2026-09-10: at mint the second assertion required the whole hardening
  # lane to be empty, because on 2026-09-06 this ticket's four rows were the only
  # hardening debt in existence. BL-1468 (BL-1452's deferred gate, 2026-09-07) and
  # BL-1488 (BL-1476's, 2026-09-08) accrued their own rows while this ticket sat
  # parked on cooldown; those runs belong to those tickets. The assertion is scoped
  # to the rows this ticket owns, the same shape BL-1468 and BL-1488 already use.
  Scenario: every 2026-08-19 ledger row is discharged and the register holds no hardening row naming BL-1441
    When the parcel's own hardening-debt ledger and standing-red register are read
    Then no outstanding row is dated 2026-08-19
    And the register report holds no hardening lane row naming BL-1441

  # BL-1441 each-run-completed-with-no-unexplained-survivor-02
  Scenario Outline: each discharged row points at evidence of a completed run
    When the discharge evidence for the mutation gate of <parcel> is read
    Then it records a completed run with zero surviving mutants or a reason per survivor

    Examples:
      | parcel                                       |
      | BL-620                                       |
      | BL-955                                       |
      | BL-954-a-bounce-verifies-its-own-revert      |
      | BL-956-pipeline-board-caption-and-cap-hotfix |
