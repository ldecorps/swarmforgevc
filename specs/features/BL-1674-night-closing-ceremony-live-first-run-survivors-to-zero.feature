Feature: BL-1674 nightClosingCeremonyLive leaves no unexplained first-run mutant

  BL-1640's hardener ran the first scoped Stryker pass over extension/src/quality/nightClosingCeremonyLive.ts on
  2026-09-21: 260 mutants, 57 survived, 27 never covered against a
  three-file include set, spread over 7 declarations and none in
  BL-1640's own changed lines. This feature is that the file's mutation
  run over the full unit suite ends with no unexplained survivor and that
  each declaration's killed group names the behaviour test that kills it.

  # BL-1674 the-run-over-the-full-suite-leaves-no-unexplained-survivor-01
  Scenario: the scoped run over the full unit suite leaves no unexplained survivor
    Given the parcel commit compiled and the scoped Stryker run over nightClosingCeremonyLive.js recorded in the evidence
    When the evidence is read
    Then every mutant Stryker reports is killed or listed as an accepted equivalent with its code-level reason
    And the run reports at least 250 mutants

  # BL-1674 each-killed-group-names-the-test-that-kills-it-02
  Scenario: each declaration's survivor group is killed by a named behaviour test
    Given the declarations named in the ticket's census
    When the evidence is read
    Then each declaration's killed group names a unit test that pins the decision or boundary the mutant changed
