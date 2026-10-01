Feature: BL-1865 bl1343's property tests finish well inside their budget

  `extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js`
  went red in QA's full property-lane run for BL-1853 on 2026-10-01 and
  carried no register row. Run alone on origin/main the same day, its two
  tests took 18424 ms and 15558 ms against a 20000 ms base budget at a
  1-minute load of 4.0, the property lane's quiet ceiling. Each of its 27
  draws per test starts a fresh `bb` that loads the 4071-line
  `land_step_lib.bb`, about 1.0 s per load against 0.03 s for a bare
  `bb`. A file that close to its budget alone goes red whenever the lane
  is busy. Each test now loads the lib once rather than once per draw,
  with the same draws and the same assertions. How long the file then
  takes is recorded in the parcel's evidence and judged by the
  standing-red register, not asserted here: on this shared host the
  fastest of three solo runs of the same fixed build ranged from 7840 to
  12694 ms for one test across four batches (coder, 2026-10-01).

  # BL-1865 each-test-loads-the-lib-once-01
  Scenario: a solo run of the bl1343 property file loads land_step_lib.bb once per test
    When the bl1343 property file is run alone once with every bb launch counted
    Then both of its tests pass
    And land_step_lib.bb is loaded exactly 2 times in that run

  # BL-1865 the-draws-are-unchanged-02
  Scenario: the bl1343 property file still draws 9 cases per shape in each test
    When the bl1343 property file's source is read
    Then it declares exactly 2 tests
    And each test runs runsPerCell(27, SHAPES.length) draws for each of the shapes "all-sibling", "mixed" and "none-sibling"

  # BL-1865 the-register-row-follows-the-ticket-03
  Scenario: the register row for the bl1343 property file follows BL-1865
    When the standing-red register is read
    Then the row for "extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js" is present and owned by BL-1865 while BL-1865 is open, and absent once BL-1865 is in backlog/done
