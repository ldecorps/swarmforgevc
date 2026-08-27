# mutation-stamp: sha256=bc1b9ba0e3184317448b66cce5dec3047e8f28393ed124239c6333d41c67b9d2
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-10T03:26:59.373451Z","feature_name":"BL-868 the property lane enforces the same isolation guards as the unit lane","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-868-property-lane-isolation-guards.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":3,"name":"every lane that executes test files registers the shared isolation guards","scenario_hash":"148405d0366a3a115ba007e89578c6938a80d94b9cabd8f89e5d10ad8143f16d","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-10T03:26:59.373451Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-868 the property lane enforces the same isolation guards as the unit lane

  vitest.properties.config.mjs wires no setupFiles, so neither BL-420's
  temp-directory sweep (tmpDirSetup.js) nor BL-720's process.env restore guard
  (envRestoreGuardSetup.js) runs for any property file. Every mkTmpDir() a
  property test calls registers a directory for a sweep that never happens, and
  a property test may leave process.env modified with nothing to catch it.

  # BL-868 property-lane-isolation-guards-01
  Scenario: temp directories a property test creates are swept when it finishes
    Given a property test that creates a temp directory through the shared helper
    When the property lane runs it
    Then no temp directory it created survives the run

  # BL-868 property-lane-isolation-guards-02
  Scenario: a property test that leaves the environment modified fails loudly
    Given a property test that leaves a process.env key changed
    When the property lane runs it
    Then the run fails
    And the failure names the leaked key

  # BL-868 property-lane-isolation-guards-03
  Scenario: the guards do not change the verdict of a property test that is already clean
    Given a property test that sweeps its own state and restores the environment
    When the property lane runs it
    Then the run passes

  # BL-868 property-lane-isolation-guards-04
  Scenario Outline: every lane that executes test files registers the shared isolation guards
    Given the Vitest configuration <config>
    When its registered setup files are read
    Then they include the temp-directory sweep and the environment restore guard

    Examples:
      | config                       |
      | vitest.config.mjs            |
      | vitest.properties.config.mjs |
