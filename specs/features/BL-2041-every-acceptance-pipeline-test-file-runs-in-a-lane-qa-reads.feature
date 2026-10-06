Feature: BL-2041 Every acceptance-pipeline test file runs in a lane QA reads

  The tests under specs/pipeline/test cover the acceptance runner and its
  step handlers' own failure branches. No lane runs them: QA's gather runs
  npm test and the property lane from extension/, and neither includes that
  directory. On 2026-10-06 a run of the directory found four files red,
  unseen for weeks: BL-989's portable-grep guard (two shell tests had
  gone back to grep -P), a burndown handler test resolving steps BL-1277
  had scoped, BL-227's handler test against a workflow that changed its
  quoting on 2026-07-22, and a test of a handler BL-267 deleted on
  2026-07-11. The specifier hotfixed them. After this parcel the directory
  runs in a lane every parcel's gather runs, so the next one goes red
  where somebody sees it.

  # BL-2041 the-lane-runs-the-directory-01
  Scenario: the lane QA's gather runs executes every test file under specs/pipeline/test
    Given the test files under specs/pipeline/test, fixtures excluded
    When the lane QA's gather runs is executed on the parcel commit
    Then every one of those files runs in it
    And the census of those files is 39, counted with find specs/pipeline/test -name '*.test.js' -not -path '*/fixtures/*'

  # BL-2041 a-red-file-fails-the-lane-02
  Scenario: a failing test file under specs/pipeline/test fails the lane
    Given a fixture copy of the lane in which one specs/pipeline/test file asserts false
    When that lane is executed
    Then it exits non-zero and names the failing file

  # BL-2041 concurrent-runs-keep-their-fixtures-03
  Scenario: two concurrent runs of BL-1358's ceiling test both pass
    Given two invocations of specs/pipeline/test/bl1358MutantTimeCeiling.test.js start together
    When both finish
    Then both pass
    And neither run removed a fixture root the other run still owned
