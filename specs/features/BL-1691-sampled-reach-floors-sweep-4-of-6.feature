Feature: BL-1691 sampled reach floors sweep 4 of 6

  A property test that draws a case space a few times and afterwards
  asserts every arm was reached carries a seed-miss probability on every
  run and goes red in QA's lane with nothing wrong in the code. On
  2026-09-22 bl1402FrontDeskPhotoPassthroughInvariants did exactly that
  in the BL-1686 lane run (already-saved drawn 0 of 25). This sweep, 4 of
  6 under epic BL-1583, takes the 15 files whose smallest literal draw
  budget is 17 to 30 and that BL-1584's classifier reads sampled-low, and
  makes each reach its floor by construction: an outer iteration over the
  cells, runsPerCell draws each, the floor asserted through
  assertReachFloor at its unchanged value. Green runs and the floor audit
  are QA's e2e steps, not scenarios here: a whole-feature vitest run
  would not fit the per-mutant ceiling.

  # BL-1691 sampled-reach-floors-sweep-4-of-6-01
  Scenario Outline: each swept file reaches its reach floor by construction through the shared helpers
    When the source of <file> is read
    Then it derives a draw count through runsPerCell from helpers/reachFloors
    And it asserts a reach floor through assertReachFloor from helpers/reachFloors

    Examples:
      | file                                                                                  |
      | extension/test/bl1210IconMarkerStoreInvariants.property.test.js                       |
      | extension/test/bl1243PaneActivityInvariants.property.test.js                          |
      | extension/test/bl1340SelfConvertingDraftInvariants.property.test.js                   |
      | extension/test/bl1356StampOffInvariants.property.test.js                              |
      | extension/test/bl1365RitualLedgerInvariants.property.test.js                          |
      | extension/test/bl1383ProviderChatSeatInvariants.property.test.js                      |
      | extension/test/bl1384LocalSeatTopicForwardedInvariants.property.test.js               |
      | extension/test/bl1398GuardFixtureDerivedSet.property.test.js                          |
      | extension/test/bl1402FrontDeskPhotoPassthroughInvariants.property.test.js             |
      | extension/test/bl1455RependedApprovalAskInvariants.property.test.js                   |
      | extension/test/bl1471BounceRevertScopeInvariants.property.test.js                     |
      | extension/test/bl1477ContextTelemetryTornTailInvariants.property.test.js              |
      | extension/test/bl1484HookFixturesDeriveTheirSet.property.test.js                      |
      | extension/test/bl1539SelfRootingDerivationStability.property.test.js                  |
      | extension/test/bl1565CoordinatorNeverReceivesGitHandoffInvariants.property.test.js    |

  # BL-1691 sampled-reach-floors-sweep-4-of-6-02
  Scenario: the sweep's pinned list is the classifier's sampled-low set for its bucket, and every pinned file reads constructed afterwards
    When the BL-1691 pinned file list is read from scenario 01
    Then it names exactly 15 property test files
    And every one of them exists under extension/test
    And the sampled reach floor census CLI reads every one of them as constructed
