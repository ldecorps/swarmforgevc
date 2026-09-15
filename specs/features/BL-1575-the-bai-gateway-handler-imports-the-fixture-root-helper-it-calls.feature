Feature: BL-1575 The b.ai gateway seat handler imports the fixture-root helper it calls

  BL-1410's migration (046a7d9b84, 2026-09-09) replaced the local mkTmpDir
  in bl1495BaiGatewaySeatSteps.js with three mkSocketFixtureRoot calls but
  never added the require the ten sibling handlers received, so every
  BL-1495 scenario dies in its Background with "mkSocketFixtureRoot is not
  defined" and the acceptance lane has carried the feature red on main
  since. This feature is that the handler imports what it calls, the
  BL-1495 feature is green again, and no other handler in the lane calls
  the helper without importing it.

  # BL-1575 bai-gateway-handler-imports-helper-01
  Scenario: the handler requires the helper it calls
    When the file specs/pipeline/steps/bl1495BaiGatewaySeatSteps.js is read as code
    Then it requires mkSocketFixtureRoot from the steps-lane helper lib/socketFixtureRoot

  # BL-1575 bai-gateway-handler-imports-helper-02
  Scenario: the BL-1495 feature is green on the tree as it stands
    When the feature for "BL-1495" runs under the acceptance runner
    Then every one of its 7 scenario runs passes

  # BL-1575 bai-gateway-handler-imports-helper-03
  Scenario: every handler that calls the helper imports it
    When every step handler under specs/pipeline/steps that calls mkSocketFixtureRoot is collected
    Then the collection holds at least 123 handlers including bl1495BaiGatewaySeatSteps.js and bl802BabysitterdMacosPortabilitySteps.js
    And no member of the collection is missing the require of lib/socketFixtureRoot
