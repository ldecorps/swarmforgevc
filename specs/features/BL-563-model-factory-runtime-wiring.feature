# mutation-stamp: sha256=2d77b08601fa32b5d26faadf798edc203b1801fa1710880a7c31622423d6f953
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-24T14:31:57.560257008Z","feature_name":"model-factory assignment changes what launches","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-563-model-factory-runtime-wiring.feature","background_hash":"1771b50e6c9effb71d91f4a5d46c2cb1c4c102f9b0a4bc99c280411844eea450","implementation_hash":"unknown","scenarios":[{"index":2,"name":"a broken overlay degrades to pack-derived values without aborting the launch","scenario_hash":"76a3f5455176d4ae2c786383ffd7d2a3516bf6fbbd261645a2fec7c29e9f7312","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-24T14:31:57.560257008Z"}]}
# acceptance-mutation-manifest-end

Feature: model-factory assignment changes what launches

  Background:
    Given a pack conf whose window line for role "coder" carries --model "sonnet"
    And the model-factory assignment overlay path is .swarmforge/model-factory/assignment.json

  # BL-563 model-factory-runtime-wiring-01
  Scenario: assignment overlay overrides the pack model for a named role
    Given the assignment overlay names model "opus" for role "coder"
    When the launcher writes the role settings files
    Then .swarmforge/launch/coder.claude-settings.json carries model "opus"

  # BL-563 model-factory-runtime-wiring-02
  Scenario: with no overlay present the settings files are byte-identical to pack-derived output
    Given no .swarmforge/model-factory/assignment.json exists
    When the launcher writes the role settings files
    Then every role's settings file is byte-identical to the pack-derived baseline

  # BL-563 model-factory-runtime-wiring-03
  Scenario Outline: a broken overlay degrades to pack-derived values without aborting the launch
    Given the assignment overlay file is <broken-state>
    When the launcher writes the role settings files
    Then every role's settings file carries its pack-derived model
    And the settings-writing step completes without error

    Examples:
      | broken-state   |
      | malformed JSON |
      | truncated      |
      | empty          |

  # BL-563 model-factory-runtime-wiring-04
  Scenario: an overlay naming only some roles leaves unnamed roles on pack values
    Given the assignment overlay names a model only for role "coder"
    When the launcher writes the role settings files
    Then coder's settings file carries the overlay model
    And the settings files for roles the overlay does not name keep their pack-derived models

  # BL-563 model-factory-runtime-wiring-05
  Scenario: cold-apply's freshly written overlay is the overlay the relaunched swarm consults
    Given a cold-apply plan whose overlay_path names a freshly written assignment overlay
    When the default launch seam executes the plan against a stub launcher
    Then the stub launcher consults that overlay when writing settings files

  # BL-563 model-factory-runtime-wiring-06
  Scenario: the launch call site passes the resolved model to prompt composition
    Given the assignment overlay names model "opus" for role "coder"
    When the launcher composes coder's system-prompt artifact
    Then the compose invocation for "coder" receives model "opus"
    And the composed artifact's metadata records model "opus"
