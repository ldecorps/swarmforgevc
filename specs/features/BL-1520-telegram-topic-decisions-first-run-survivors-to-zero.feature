Feature: BL-1520 The first-run mutation survivors on telegramTopicDecisions.ts are killed

  BL-1441 ran the Stryker gate BL-620 deferred on 2026-08-19 and
  discharged the ledger row on a completed run. That run was the first
  time out/tools/telegramTopicDecisions.js had been mutation-tested: 234
  mutants, 208 killed, 26 survived, none without coverage, spread over
  six decision functions and four exported constants. The discharge
  recorded every survivor with a reason and the specifier ruled, on the
  hardender's rule proposal of 2026-09-10, that a discharge with
  survivors is legitimate only when a ticket owns them. This ticket owns
  these 26 and drives them to zero with behaviour tests, or records the
  code-level equivalence of any it does not kill. Both scenarios read the
  parcel's own committed evidence, the contract at this commit.

  # BL-1520 the-run-over-the-full-suite-leaves-no-unexplained-survivor-01
  Scenario: the run over the full unit suite leaves no unexplained survivor
    When the parcel's discharge evidence for out/tools/telegramTopicDecisions.js is read
    Then it records a completed Stryker run whose dry-run include set is the full unit suite
    And it instrumented at least 230 mutants
    And it records zero no-coverage mutants and zero survived mutants, or names each remaining survivor as an accepted equivalent with the code-level reason and the grep that proves no consumer distinguishes it

  # BL-1520 each-killed-group-names-the-test-that-kills-it-02
  Scenario: each survivor group is killed by a named behaviour test
    When the parcel's discharge evidence for out/tools/telegramTopicDecisions.js is read
    Then every function named in the census for this file appears with the test file and case that now rejects its mutants
