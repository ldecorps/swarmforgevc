Feature: pilot land gate checks new tests against the shared mkTmpDir convention

  # BL-743: BL-627 added pricingTable.test.js with raw fs.mkdtempSync instead of
  # mkTmpDir() (BL-420/BL-714). Nothing in /pilot review checked the new test against
  # the repo's test-infra convention before land. Pre-land mechanical check on touched
  # test files — not a later repo-wide sweep. Companion code fix: BL-742.

  Background:
    Given a piloted ticket whose declared acceptance contract has just passed

  # BL-743 touched-test-mkdtemp-check-01
  Scenario: the pilot land gate scans touched test files for raw mkdtemp outside the shared helper
    Given the run's commits touched extension/test files
    When the pilot runs the landing gate
    Then the gate scans those touched paths for raw mkdtempSync call sites outside helpers/tmpDir.js

  # BL-743 raw-mkdtemp-refuses-02
  Scenario: raw mkdtemp in a touched new test file refuses the land
    Given the run's commits added a test that calls fs.mkdtempSync directly
    When the pilot runs the landing gate
    Then the land is refused for raw mkdtemp outside the shared helper
    And the refusal names the offending test file

  # BL-743 mkTmpDir-passes-03
  Scenario: a touched test that uses mkTmpDir does not fail the mkdtemp convention gate
    Given the run's commits touched a test file that allocates temp dirs only via mkTmpDir
    When the pilot runs the landing gate
    Then the mkdtemp convention check completes without refusal for that file

  # BL-743 hardener-prompt-convention-04
  Scenario: hardener guidance requires checking new tests against shared helper conventions before land
    When the hardener role prompt is read
    Then it requires new or touched tests using os.tmpdir to use mkTmpDir not raw mkdtempSync
    And it states this check runs at pilot or pipeline land not only in a later repo-wide sweep

  # BL-743 refused-mkdtemp-no-durable-05
  Scenario: a refused raw-mkdtemp land writes nothing durable
    Given the run's commits touched a test with raw mkdtempSync outside the shared helper
    When the pilot runs the landing gate
    Then the land is refused for raw mkdtemp outside the shared helper
    And the ticket yaml stays where it was
    And no acceptance receipt is written
