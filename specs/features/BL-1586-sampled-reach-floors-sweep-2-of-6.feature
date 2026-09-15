Feature: BL-1586 sampled reach floors sweep 2 of 6

  A property test that draws a case space a few times and afterwards
  asserts every arm was reached carries a seed-miss probability on every
  run and goes red in QA's lane with nothing wrong in the code. Seven
  such files were minted as high-severity unowned reds in ten days, and
  the specifier's census of 2026-09-15 found 108 more of the shape. This
  sweep, 2 of 6 under epic BL-1583, takes the 16 files whose smallest
  literal draw budget is 8 or fewer (second half by name) and makes each reach its floor by
  construction: an outer iteration over the cells, runsPerCell draws
  each, the floor asserted through assertReachFloor at its unchanged
  value. Green runs and the floor audit are QA's e2e steps, not
  scenarios here: a whole-feature vitest run would not fit the
  per-mutant ceiling.

  # BL-1586 sampled-reach-floors-sweep-2-of-6-01
  Scenario Outline: each swept file reaches its reach floor by construction through the shared helpers
    When the source of <file> is read
    Then it derives a draw count through runsPerCell from helpers/reachFloors
    And it asserts a reach floor through assertReachFloor from helpers/reachFloors

    Examples:
      | file                                                                                 |
      | extension/test/bl1342CrashloopStampInvariants.property.test.js                      |
      | extension/test/bl1344WaiveInvariants.property.test.js                               |
      | extension/test/bl1345StaleMarkerInvariants.property.test.js                         |
      | extension/test/bl1346RcRepairStampInvariants.property.test.js                       |
      | extension/test/bl1350KeepaliveInvariants.property.test.js                           |
      | extension/test/bl1352EscalationVisibilityInvariants.property.test.js                |
      | extension/test/bl1354SharedPathLandedSiblingInvariants.property.test.js             |
      | extension/test/bl1362ReviewEvidenceByToolInvariants.property.test.js                |
      | extension/test/bl1375ApprovedSiblingsCanLandInvariants.property.test.js             |
      | extension/test/bl1380ExpediteNeverAnswersUnshownQuestion.property.test.js           |
      | extension/test/bl1389UnlandedSiblingPathNeverRidesInvariants.property.test.js       |
      | extension/test/bl1460IdleEventsOneSnapshotInvariants.property.test.js               |
      | extension/test/bl1481SharedPathContentCheckInvariants.property.test.js              |
      | extension/test/bl1538Bl1028RunnerFixtureClosureInvariants.property.test.js          |
      | extension/test/bl1546ClosedOwnerNeverSilentlyExcludesInvariants.property.test.js    |
      | extension/test/bl687EpicTileSurfaceUntouched.property.test.js                       |

  # BL-1586 sampled-reach-floors-sweep-2-of-6-02
  Scenario: the sweep's pinned list is the census section it was minted from
    When the BL-1586 pinned file list is read from scenario 01
    Then it names exactly 16 property test files
    And every one of them exists under extension/test
