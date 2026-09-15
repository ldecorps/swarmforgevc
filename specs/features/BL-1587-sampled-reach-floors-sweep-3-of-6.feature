Feature: BL-1587 sampled reach floors sweep 3 of 6

  A property test that draws a case space a few times and afterwards
  asserts every arm was reached carries a seed-miss probability on every
  run and goes red in QA's lane with nothing wrong in the code. Seven
  such files were minted as high-severity unowned reds in ten days, and
  the specifier's census of 2026-09-15 found 108 more of the shape. This
  sweep, 3 of 6 under epic BL-1583, takes the 11 files whose smallest
  literal draw budget is 9 to 16 and makes each reach its floor by
  construction: an outer iteration over the cells, runsPerCell draws
  each, the floor asserted through assertReachFloor at its unchanged
  value. Green runs and the floor audit are QA's e2e steps, not
  scenarios here: a whole-feature vitest run would not fit the
  per-mutant ceiling.

  # BL-1587 sampled-reach-floors-sweep-3-of-6-01
  Scenario Outline: each swept file reaches its reach floor by construction through the shared helpers
    When the source of <file> is read
    Then it derives a draw count through runsPerCell from helpers/reachFloors
    And it asserts a reach floor through assertReachFloor from helpers/reachFloors

    Examples:
      | file                                                                                 |
      | extension/test/bl1218RemoteControlConfigInvariants.property.test.js                 |
      | extension/test/bl1239SuiteManifestAccountsForEveryTestFile.property.test.js         |
      | extension/test/bl1254LedgerCertificationNeedsAHuman.property.test.js                |
      | extension/test/bl1275RefusalEvidenceInvariants.property.test.js                     |
      | extension/test/bl1305FixtureAgentBinary.property.test.js                            |
      | extension/test/bl1308SiblingDetectorCoversReplay.property.test.js                   |
      | extension/test/bl1315OwnPathsFullRangeInvariants.property.test.js                   |
      | extension/test/bl1317AdaptEffortInvariants.property.test.js                         |
      | extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js             |
      | extension/test/bl1445StaffingGateWiringTestDecidesOverrideInvariants.property.test.js |
      | extension/test/bl1495BaiGatewayInvariants.property.test.js                          |

  # BL-1587 sampled-reach-floors-sweep-3-of-6-02
  Scenario: the sweep's pinned list is the census section it was minted from
    When the BL-1587 pinned file list is read from scenario 01
    Then it names exactly 11 property test files
    And every one of them exists under extension/test
