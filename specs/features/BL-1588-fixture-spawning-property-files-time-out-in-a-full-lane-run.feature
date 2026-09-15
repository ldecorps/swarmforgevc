Feature: BL-1588 Fixture-spawning property files are green in a full lane run

  QA's two full property-lane runs on the BL-1580 parcel (2026-09-15)
  timed out four fixture-spawning property files at the lane's raw
  20-second ceiling, a different pair each run, every one green alone on
  a quiet host at 8 to 15 seconds. One of them already carries BL-1579's
  load-relative budget and still printed the unscaled 20000 ms: the
  1-minute load average that budget reads lags the lane's own ramp, and
  the long files run in the lane's first wave. This feature is that the
  parcel reproduces the red under a full lane run with its text
  recorded, makes the budget a fixture-spawning test receives reflect the
  lane's own concurrency without lowering a floor, deleting an assertion
  or raising a bare constant, and leaves the four files green alone and
  in the full lane, or retires the rows on the recorded green runs when
  nothing reproduces.

  # BL-1588 fixture-spawning-property-files-green-in-a-full-lane-run-01
  Scenario Outline: each property file is green on the tree as it stands
    When <file> runs alone under the properties config
    Then every test in it passes

    Examples:
      | file                                                                     |
      | extension/test/bl1308SiblingDetectorCoversReplay.property.test.js        |
      | extension/test/bl1315OwnPathsFullRangeInvariants.property.test.js        |
      | extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js  |
      | extension/test/bl1354SharedPathLandedSiblingInvariants.property.test.js  |

  # BL-1588 fixture-spawning-property-files-green-in-a-full-lane-run-02
  Scenario Outline: the parcel's evidence records the full-lane failure and its remedy for each file
    When the parcel's evidence for <file> is read
    Then it records the failing test name and the timeout message verbatim from a full property-lane run and the change that removed it, or it records at least 5 full lane runs and 20 runs alone all green and the register row retired on that evidence

    Examples:
      | file                                                                     |
      | extension/test/bl1308SiblingDetectorCoversReplay.property.test.js        |
      | extension/test/bl1315OwnPathsFullRangeInvariants.property.test.js        |
      | extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js  |
      | extension/test/bl1354SharedPathLandedSiblingInvariants.property.test.js  |

  # BL-1588 fixture-spawning-property-files-green-in-a-full-lane-run-03
  Scenario Outline: the budget a fixture-spawning test receives reflects the lane's own concurrency
    Given the property lane is running <forks> worker forks
    And the host's 1-minute load average reads <load>, inside the quiet band
    When the per-test budget for a fixture-spawning property test is resolved from a 20000 ms base
    Then the effective budget is <outcome>

    Examples:
      | forks | load | outcome                         |
      | 1     | 1.8  | exactly 20000 ms                |
      | 8     | 1.8  | more than 20000 ms              |
      | 16    | 1.8  | more than the 8-fork budget     |
