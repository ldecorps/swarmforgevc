Feature: BL-2105 A scoped Stryker dry run is budgeted for the suite it runs

  The hardener's scoped Stryker runs start from extension/stryker.config.json,
  which sets no `dryRunTimeoutMinutes`, so Stryker's own default of 5
  minutes applies. A perTest dry run executes the whole vitest unit suite
  under instrumentation, and that suite alone takes about 10 minutes on
  this loaded host (BL-1599's work ratchet, 605 s). Twice the dry run hit
  the 5-minute ceiling and the hardener fell back to hand mutation
  (verification-debt category stryker-dry-run-timeout-fallback: BL-1836,
  BL-1858); six per-ticket configs already raise the budget to 15 by hand
  and ten do not. This feature is that the base config carries the budget,
  so no scoped run starts from the 5-minute default.

  # BL-2105 scoped-stryker-dry-run-budget-01
  Scenario: the base Stryker config gives the dry run the budget the hand configs settled on
    When the base Stryker config extension/stryker.config.json is read
    Then its dryRunTimeoutMinutes is at least 15
