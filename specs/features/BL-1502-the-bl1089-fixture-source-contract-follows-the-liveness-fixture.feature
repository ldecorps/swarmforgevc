Feature: BL-1502 The bl1089 fixture-source contract follows the liveness fixture it guards

  extension/test/bl1089FrontDeskLivenessFixture.property.test.js carries a
  fixture-source contract: the front-desk liveness fixture's
  served-then-stopped helper stamps an OWN heartbeat at age 0 and never
  backdates it 5000ms into a predecessor's lifetime (BL-1089 invariant 2).
  BL-1285 (9021f12bb2, 2026-09-08) kept that substance - the helper still
  writes age 0 - but renamed the helper from
  stamp_own_heartbeat_then_age_past_stall to
  stamp_own_heartbeat_immediately_stale, and the contract pins the old
  name, so the property lane has been red since. This feature is that the
  contract asserts the property BL-1089 owns and follows the fixture as it
  stands, so a rename never reads as a regression while a real backdate
  still does.

  # BL-1502 fixture-source-contract-follows-the-fixture-01
  Scenario: the property file is green on the tree as it stands
    When extension/test/bl1089FrontDeskLivenessFixture.property.test.js runs alone under the properties config
    Then every test in it passes

  # BL-1502 fixture-source-contract-follows-the-fixture-02
  Scenario Outline: the contract accepts the fixture BL-1285 landed and still refuses a served heartbeat that predates spawn
    Given <fixture>
    When the fixture-source contract is evaluated against that text
    Then the verdict is <verdict>

    Examples:
      | fixture                                                                                        | verdict                  |
      | the liveness fixture as it stands on the tree                                                  | pass                     |
      | a copy of the liveness fixture whose served-then-stopped helper stamps a 5000ms backdate instead of age 0 | fail naming the backdate |
