Feature: BL-1672 residentPaneLive.ts leaves no unexplained first-run mutant

  BL-522 shipped residentPaneLive.ts on 2026-07-19 and BL-775's hardener
  deferred its first Stryker run on 2026-09-18 when the dry run timed out
  under load. BL-1638 ran that gate on 2026-09-21 on a quiet host: 224
  mutants on the file, 148 killed, 67 survived, 9 never covered, spread
  over twelve declarations - every one a real assertion gap by the coder's
  inspection (exact pane ids, labels, role comparisons and failure paths
  that existing tests assert only loosely). This feature is that the
  file's mutation run ends with no unexplained survivor and that each
  declaration's killed group names the behaviour test that kills it.

  # BL-1672 the-run-over-the-full-suite-leaves-no-unexplained-survivor-01
  Scenario: the scoped run over the full unit suite leaves no unexplained survivor
    Given the parcel commit compiled and the scoped Stryker run over residentPaneLive.js recorded in the evidence
    When the evidence is read
    Then every mutant Stryker reports is killed or listed as an accepted equivalent with its code-level reason
    And the run reports at least 220 mutants

  # BL-1672 each-killed-group-names-the-test-that-kills-it-02
  Scenario: each declaration's survivor group is killed by a named behaviour test
    Given the twelve declarations named in the ticket's census
    When the evidence is read
    Then each declaration's killed group names a unit test that pins the exact pane id, label, role comparison or failure path the mutant changed
