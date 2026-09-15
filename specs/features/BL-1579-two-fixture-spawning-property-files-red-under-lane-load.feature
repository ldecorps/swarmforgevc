Feature: BL-1579 Two fixture-spawning property files are green under lane load

  QA's third property-lane run on the BL-1509 parcel (2026-09-15) reported
  bl1343ReplayNeverDropsOwnPathInvariants and bl1323StampOffInvariants
  red and described each as a reach-floor assertion, with no assertion
  text recorded. Neither file can miss a floor: both iterate their shapes
  by construction, and the one draw-dependent floor missed 0 of 3000
  simulated seeds. Both spawn a git or bb fixture per draw and run 10 to
  13 seconds alone against the lane's 20-second test timeout, and QA's
  runs were concurrent with a Stryker run and a full unit suite. This
  feature is that the parcel reproduces the red with its text recorded,
  removes the observed cause without lowering a floor or deleting an
  assertion, and leaves both files green alone and under lane load, or
  retires the rows on the recorded green runs when nothing reproduces.

  # BL-1579 two-fixture-spawning-property-files-green-under-load-01
  Scenario Outline: each property file is green on the tree as it stands
    When <file> runs alone under the properties config
    Then every test in it passes

    Examples:
      | file                                                                    |
      | extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js |
      | extension/test/bl1323StampOffInvariants.property.test.js                |

  # BL-1579 two-fixture-spawning-property-files-green-under-load-02
  Scenario Outline: the parcel's evidence records the observed failure and its remedy for each file
    When the parcel's evidence for <file> is read
    Then it records the failing test name and the assertion or timeout message verbatim from a lane run under concurrent load and the change that removed it, or it records at least 5 loaded lane runs and 20 runs alone all green and the register row retired on that evidence

    Examples:
      | file                                                                    |
      | extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js |
      | extension/test/bl1323StampOffInvariants.property.test.js                |
