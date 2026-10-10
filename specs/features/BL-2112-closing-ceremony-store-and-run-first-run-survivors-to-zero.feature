Feature: BL-2112 closingCeremonyStore and closingCeremonyRun leave no unexplained first-run mutant

  BL-2009's hardener ran the first Stryker pass over the closing
  ceremony's three files on 2026-10-10 over the full unit suite (742
  mutants tested, 145 survived, 18 never covered), none in a parcel's own
  changed lines. This slice owns 48 of them: 48 survived and
  0 never covered in closingCeremonyStore.ts and closingCeremonyRun.ts. This feature is that the run over
  its files ends with no unexplained survivor and that each declaration's
  killed group names the behaviour test that kills it.

  # BL-2112 the-run-over-the-full-suite-leaves-no-unexplained-survivor-01
  Scenario: the run over the full unit suite leaves no unexplained survivor in the slice's declarations
    Given the parcel commit compiled and the Stryker run over out/metrics/closingCeremonyStore.js,out/metrics/closingCeremonyRun.js recorded in the evidence
    When the evidence is read
    Then every mutant Stryker reports in the slice's declarations is killed or listed as an accepted equivalent with its code-level reason
    And the run reports at least 240 mutants

  # BL-2112 each-killed-group-names-the-test-that-kills-it-02
  Scenario: each declaration's survivor group is killed by a named behaviour test
    Given the declarations named in the ticket's census
    When the evidence is read
    Then each declaration's killed group names a unit test that pins the decision or boundary the mutant changed
