Feature: BL-1577 The first-run mutation survivors on telegramClient.ts leave with an owner and a disposition each

  extension/src/notify/telegramClient.ts is the one HTTP client every
  Telegram-facing surface of the swarm calls: the front desk, the
  concierge, the Cursor bridge and the briefing all reach the Bot API
  through it. BL-1509's hardener ran Stryker over the whole compiled
  file on 2026-09-15 to gate its own sendDocument addition, and that run
  was the first mutation run ever over the file: 656 mutants, 107
  survived and 19 without coverage in functions BL-1509 never touched.
  The hardener chased its own two survivors in-pass and, per the
  first-run discharge rule of 2026-09-10, handed the rest to the
  specifier as an unowned-survivors note. This ticket owns them: the
  no-coverage mutants go to zero over the full unit suite, and every
  remaining survivor carries a recorded disposition under the BL-1519
  ruling. All three scenarios read the parcel's own committed evidence,
  the contract at this commit.

  # BL-1577 the-run-over-the-full-suite-leaves-no-uncovered-mutant-01
  Scenario: the run over the full unit suite leaves no mutant without coverage
    When the parcel's discharge evidence for out/notify/telegramClient.js is read
    Then it records a completed Stryker run whose dry-run include set is the full unit suite
    And it instrumented at least 640 mutants
    And it records zero no-coverage mutants

  # BL-1577 each-uncovered-region-names-the-test-that-reaches-it-02
  Scenario: each function the census names as unreached appears with the test that now reaches it
    When the parcel's discharge evidence for out/notify/telegramClient.js is read
    Then every function the census lists with a no-coverage mutant appears with the test file and case that now executes it

  # BL-1577 every-remaining-survivor-carries-a-disposition-03
  Scenario: every remaining survived mutant is listed with its function and a disposition
    When the parcel's discharge evidence for out/notify/telegramClient.js is read
    Then every survived mutant the summary reports is listed with its enclosing function and one disposition among killed, accepted equivalent with the code-level reason, grandfathered under the BL-1519 ruling, or owned by a named ticket
    And the count of listed rows equals the summary's survived count
