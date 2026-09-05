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
  with evidence, and that the hardening lane of the register is then
  empty. Both scenarios read the parcel's own committed ledger, evidence
  and register, a read-only live-tree read justified because they are the
  contract at this commit.

  # BL-1441 every-remaining-0819-row-is-discharged-01
  Scenario: every 2026-08-19 ledger row is discharged and the register's hardening lane is empty
    When the parcel's own hardening-debt ledger and standing-red register are read
    Then no outstanding row is dated 2026-08-19
    And the register report holds no hardening lane row

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
