Feature: BL-1865 bl1343's property tests finish well inside their budget

  `extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js`
  went red in QA's full property-lane run for BL-1853 on 2026-10-01 and
  carried no register row. Run alone on origin/main the same day, its two
  tests took 18424 ms and 15558 ms against a 20000 ms base budget at a
  1-minute load of 4.0, the property lane's quiet ceiling. Each of its 27
  draws per test starts a fresh `bb` that loads the 4071-line
  `land_step_lib.bb`, about 1.0 s per load against 0.03 s for a bare
  `bb`. A file that close to its budget alone goes red whenever the lane
  is busy. Its two tests now finish alone in well under half that
  budget, with the same draws and the same assertions.

  # BL-1865 each-test-finishes-in-under-8000-ms-alone-01
  Scenario: each bl1343 property test finishes in under 8000 ms when run alone
    When the bl1343 property file is run alone three times
    Then each of its 2 tests finishes in under 8000 ms in its fastest run

  # BL-1865 the-draws-are-unchanged-02
  Scenario: the bl1343 property file still draws 9 cases per shape in each test
    When the bl1343 property file's source is read
    Then it declares exactly 2 tests
    And each test runs runsPerCell(27, SHAPES.length) draws for each of the shapes "all-sibling", "mixed" and "none-sibling"

  # BL-1865 the-register-row-follows-the-ticket-03
  Scenario: the register row for the bl1343 property file follows BL-1865
    When the standing-red register is read
    Then the row for "extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js" is present and owned by BL-1865 while BL-1865 is open, and absent once BL-1865 is in backlog/done
