Feature: BL-1112 standing unit reds in sampleResourcesCli and strykerSandboxSiblingsLib
  On 2026-08-23 QA verification of an unrelated parcel found seven
  deterministic unit failures that also reproduce on main and are outside
  that parcel's diff. No open ticket named either suite. Leaving them silent
  standing reds on `npm test` hides real regressions.

  Two independent failure shapes share one ticket only because the ask was
  one restoration of green for these reported suites; scenarios stay
  separate so either half can bounce alone.

  Background:
    Given the extension unit suite is run from extension/ with swarm.env loaded

  # BL-1112 sample-resources-01
  Scenario: sampleResourcesCli reports a sampled role when one is present
    Given a fixture where one role has a resource sample available
    When sampleResourcesCli runs in-process
    Then the output includes SAMPLED 1 role(s)

  # BL-1112 sample-resources-02
  Scenario: recording a resource sample appends the expected telemetry line count
    Given a clean sampleResources telemetry fixture
    When a resource sample is recorded for one role
    Then the telemetry line count matches the suite's expected count for that case

  # BL-1112 stryker-sandbox-03
  Scenario Outline: a stale sibling symlink is replaced rather than left broken
    Given an extension temp dir whose <sibling> symlink points at a removed path
    When ensureStrykerSandboxSiblingLink runs for that sibling
    Then the symlink is recreated to the live sibling target
    And the call does not throw EEXIST

    Examples:
      | sibling    |
      | pwa        |
      | swarmforge |
      | .github    |
      | docs       |
