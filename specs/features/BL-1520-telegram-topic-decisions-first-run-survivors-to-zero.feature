Feature: BL-1520 The first-run mutation survivors on the three small front-desk Telegram files are killed

  BL-1441 ran the Stryker gates BL-620 and BL-955 deferred on 2026-08-19
  and discharged both ledger rows on completed runs. Those runs were the
  first time out/tools/telegramTopicDecisions.js (234 mutants, 208
  killed, 26 survived, none without coverage, spread over six decision
  functions and four exported constants),
  out/onboarding/negotiationTelegramRelay.js (4 survivors, all
  string-literal mutants on the four operator-facing message constants)
  and out/onboarding/negotiationTelegramRouting.js (11 survivors: six on
  AMBIGUOUS_INTENT_PATTERN, four on AGREEMENT_PATTERN, one in
  renderBulletList) had been mutation-tested. The discharges recorded
  every survivor with a reason and the specifier ruled, on the
  hardender's rule proposal of 2026-09-10, that a discharge with
  survivors is legitimate only when a ticket owns them. This ticket owns
  these 41 (BL-1521's 15 absorbed 2026-09-21) and drives them to zero
  with behaviour tests, or records the code-level equivalence of any it
  does not kill. Every scenario reads the parcel's own committed
  evidence, the contract at this commit.

  # BL-1520 the-run-over-the-full-suite-leaves-no-unexplained-survivor-01
  Scenario Outline: the run over the full unit suite leaves no unexplained survivor on <file>
    When the parcel's discharge evidence for <file> is read
    Then it records a completed Stryker run whose dry-run include set is the full unit suite
    And it instrumented at least <minimum> mutants
    And it records zero no-coverage mutants and zero survived mutants, or names each remaining survivor as an accepted equivalent with the code-level reason and the grep that proves no consumer distinguishes it

    Examples:
      | file                                          | minimum |
      | out/tools/telegramTopicDecisions.js           | 230     |
      | out/onboarding/negotiationTelegramRelay.js    | 60      |
      | out/onboarding/negotiationTelegramRouting.js  | 85      |

  # BL-1520 each-killed-group-names-the-test-that-kills-it-02
  Scenario: each survivor group is killed by a named behaviour test
    When the parcel's discharge evidence for each of the three files is read
    Then every function named in the census for that file appears with the test file and case that now rejects its mutants

  # BL-1520 a-message-constant-mutant-is-killed-by-asserting-the-text-03
  Scenario: a message constant survivor is killed by a test that asserts the text a human reads
    When the parcel's discharge evidence for out/onboarding/negotiationTelegramRelay.js is read
    Then each of the four message constants appears with the test file and case that asserts its rendered text
