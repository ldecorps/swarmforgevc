Feature: BL-1669 The multi-branch parser coverage check's extraction functions leave no unexplained mutant

  BL-755 shipped multiBranchParserCoverageCheck.ts on 2026-08-26 with a
  surgical hand sweep of eight mutants and no Stryker run. BL-1667's
  hardener ran the first scoped Stryker pass over the file on 2026-09-20:
  216 mutants, 106 killed, 1 timeout, 85 survived, 21 never covered - every
  survivor and uncovered mutant in the six extraction functions and the
  no-op branch of the assessment, none in BL-1667's own lines. This feature
  is that the file's mutation run ends with no unexplained survivor and
  that each killed group names the behaviour test that kills it.

  # BL-1669 the-run-over-the-full-suite-leaves-no-unexplained-survivor-01
  Scenario: the scoped run over the full unit suite leaves no unexplained survivor
    Given the parcel commit compiled and the scoped Stryker run over multiBranchParserCoverageCheck.js recorded in the evidence
    When the evidence is read
    Then every mutant Stryker reports is killed or listed as an accepted equivalent with its code-level reason
    And the run reports at least 200 mutants

  # BL-1669 each-killed-group-names-the-test-that-kills-it-02
  Scenario: each survivor group is killed by a named behaviour test
    Given the six extraction functions and the empty-parser branch named in the ticket
    When the evidence is read
    Then each function's killed group names a unit test whose input is a source snippet that exercises the mutated line
