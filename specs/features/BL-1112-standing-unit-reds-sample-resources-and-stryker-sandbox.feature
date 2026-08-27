# mutation-stamp: sha256=f20f3e2d4c2b5362b887dfe75750626c34ab2a500eb5e9f4624ca5115149fba4
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-27T14:25:49.522485801Z","feature_name":"BL-1112 standing unit reds in sampleResourcesCli and strykerSandboxSiblingsLib","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1112-standing-unit-reds-sample-resources-and-stryker-sandbox.feature","background_hash":"2b6998a2b33827aacbf4d35526ce52852c90d743784f70931fdf1428d5b0399f","implementation_hash":"unknown","scenarios":[{"index":2,"name":"a stale sibling symlink is replaced rather than left broken","scenario_hash":"dfe3d969fcbbc1e9048ec2bdb3b3df1dd701efaa2c985dd90536d35ae7656bb1","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-24T14:44:37.224946075Z"}]}
# acceptance-mutation-manifest-end

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
