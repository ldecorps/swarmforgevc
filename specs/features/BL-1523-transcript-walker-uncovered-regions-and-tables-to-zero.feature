Feature: BL-1523 The uncovered regions and module-level tables of transcriptWalker.ts are mutation-tested to zero

  transcriptWalker.ts classifies every line of an agent transcript into
  the intervals the turn profiler and the briefing's mechanical-share
  figure read. It has been mutation-tested twice and owned by nobody both
  times: BL-1364's hardener measured 94 survivors on 2026-09-05 and
  recorded them as pre-existing, and BL-1488's deferred-gate run on
  2026-09-10 measured 394 mutants, 89 survived and 45 without coverage
  against BL-1476's four-file include set. The specifier ruled that the
  gate discharges on the completed run and that every survivor leaves
  owned. This ticket owns the 134: the no-coverage mutants and the
  module-level table survivors go to zero over the full unit suite, and
  every remaining function-body survivor carries a recorded disposition
  under the BL-1519 ruling. All three scenarios read the parcel's own
  committed evidence, the contract at this commit.

  # BL-1523 the-run-over-the-full-suite-leaves-no-uncovered-mutant-01
  Scenario: the run over the full unit suite leaves no mutant without coverage
    When the parcel's discharge evidence for out/metrics/transcriptWalker.js is read
    Then it records a completed Stryker run whose dry-run include set is the full unit suite
    And it instrumented at least 380 mutants
    And it records zero no-coverage mutants

  # BL-1523 each-module-level-table-survivor-is-killed-or-proven-02
  Scenario: each module-level table survivor is killed through its consumer or proven killed by hand-mutation
    When the parcel's discharge evidence for out/metrics/transcriptWalker.js is read
    Then each of INTERVAL_KIND_TO_CATEGORY, PROVIDER_OUTAGE_RE, TEST_RUN_RE and GIT_MECHANICAL_RE appears with the test file and case that rejects its mutants, or with the hand-mutation run that proves the suite fails

  # BL-1523 every-remaining-survivor-carries-a-disposition-03
  Scenario: every remaining survived mutant is listed with its function and a disposition
    When the parcel's discharge evidence for out/metrics/transcriptWalker.js is read
    Then every survived mutant the summary reports is listed with its enclosing function and one disposition among killed, accepted equivalent with the code-level reason, grandfathered under the BL-1519 ruling, or owned by a named ticket
    And the count of listed rows equals the summary's survived count
