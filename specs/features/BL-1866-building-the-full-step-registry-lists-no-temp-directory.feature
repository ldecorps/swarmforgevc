Feature: BL-1866 building the full step registry lists no temp directory

  `extension/test/bl800StepRegistryScopingConsistency.property.test.js`
  went red in QA's full property-lane run for BL-1822 on 2026-10-01 and
  carried no register row. Its first test builds the full step registry
  (`specs/pipeline/steps/index.js` `registerSteps`). Measured the same day,
  13 handlers listed `/tmp` from the top level of their `registerSteps`,
  once each, to sweep their own stale fixtures, and `/tmp` held about
  445,000 entries, so each listing cost about half a second. Building the
  registry took 6 to 10 s of that test's 30000 ms budget alone. Building
  the full registry now lists nothing in the temp directory, and each of
  those 13 handlers still sweeps its stale fixtures before its first
  fixture. Hotfix 635570352e landed the change and retired bl800's
  register row, so this feature carries no register-row scenario.

  # BL-1866 building-the-full-registry-lists-no-temp-directory-01
  Scenario: building the full step registry lists and removes nothing in the temp directory
    When the full step registry is built in a fresh process that records every directory listing and removal
    Then no recorded listing or removal names a path in the temp directory
    And the built registry holds at least 18000 step definitions

  # BL-1866 the-13-handlers-still-sweep-outside-registration-02
  Scenario: the 13 handlers that swept at registration still sweep their stale fixtures
    When the step handler sources are read
    Then exactly 13 handler files are the ones that swept their stale fixtures from registerSteps on 2026-10-01
    And each of them still calls its stale-fixture sweep
    And none of them calls it from the top level of registerSteps

  # BL-1866 bl800-builds-the-registry-well-inside-its-budget-03
  Scenario: bl800's full-registry test finishes in under 3000 ms when run alone
    When the bl800 property file is run alone three times
    Then its full-registry test finishes in under 3000 ms in its fastest run
