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
