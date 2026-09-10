Feature: BL-1521 The first-run mutation survivors on the negotiation Telegram relay and routing files are killed

  BL-1441 ran the Stryker gate BL-955 deferred on 2026-08-19 and
  discharged the ledger row on a completed run, the first time
  out/onboarding/negotiationTelegramRelay.js and
  out/onboarding/negotiationTelegramRouting.js had been mutation-tested.
  Relay left 4 survivors, all string-literal mutants on the four operator
  facing message constants; routing left 11, six on
  AMBIGUOUS_INTENT_PATTERN, four on AGREEMENT_PATTERN and one in
  renderBulletList. The specifier ruled, on the hardender's rule proposal
  of 2026-09-10, that a discharge with survivors is legitimate only when
  a ticket owns them. This ticket owns these 15 and drives them to zero
  with behaviour tests, or records the code-level equivalence of any it
  does not kill. Both scenarios read the parcel's own committed
  evidence, the contract at this commit.

  # BL-1521 each-file-leaves-no-unexplained-survivor-01
  Scenario Outline: the run over the full unit suite leaves no unexplained survivor on <file>
    When the parcel's discharge evidence for <file> is read
    Then it records a completed Stryker run whose dry-run include set is the full unit suite
    And it instrumented at least <minimum> mutants
    And it records zero no-coverage mutants and zero survived mutants, or names each remaining survivor as an accepted equivalent with the code-level reason and the grep that proves no consumer distinguishes it

    Examples:
      | file                                          | minimum |
      | out/onboarding/negotiationTelegramRelay.js    | 60      |
      | out/onboarding/negotiationTelegramRouting.js  | 85      |

  # BL-1521 a-message-constant-mutant-is-killed-by-asserting-the-text-02
  Scenario: a message constant survivor is killed by a test that asserts the text a human reads
    When the parcel's discharge evidence for out/onboarding/negotiationTelegramRelay.js is read
    Then each of the four message constants appears with the test file and case that asserts its rendered text
