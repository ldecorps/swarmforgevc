Feature: Deprecator scan identifies unused or seldom-used surfaces and notifies the human

  # BL-1186 (epic BL-1172): read-only Boy Scout pass that ranks code paths,
  # conf keys, and operator verbs by trailing usage, then notifies the human
  # with retirement candidates. Identify + notify only — no auto-delete.

  Background:
    Given the deprecator usage ledger is available for the target swarm root

  # BL-1186 unused-never-seen-01
  Scenario: A surface with zero hits in the trailing window is reported as unused
    Given conf key "legacy.chase.enabled" has zero hits in the last "90" days
    When the deprecator identify-unused scan runs
    Then the report lists "legacy.chase.enabled" as class "unused"
    And the report does not mutate any live configuration

  # BL-1186 seldom-few-hits-02
  Scenario: A surface with fewer than three hits in the trailing window is reported as seldom
    Given operator verb "/old-sweep" has "2" hits in the last "90" days
    When the deprecator identify-unused scan runs
    Then the report lists "/old-sweep" as class "seldom"
    And the report includes the hit count "2"

  # BL-1186 notify-human-only-03
  Scenario: The scan notifies the human without retiring anything
    Given the scan finds at least one unused or seldom candidate
    When the deprecator identify-unused scan completes
    Then a human-visible notification is queued naming each candidate and its class
    And no ticket is closed and no code is removed automatically

  # BL-1186 active-surface-ignored-04
  Scenario: A surface above the seldom threshold is omitted from the report
    Given module "extension/src/bridge/residentPaneLive.ts" has "40" hits in the last "90" days
    When the deprecator identify-unused scan runs
    Then the report does not list "extension/src/bridge/residentPaneLive.ts"
