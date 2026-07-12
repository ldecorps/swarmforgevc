Feature: The coordinator's model and effort are pack-configurable instead of hardcoded to Opus

  # BL-314 coordinator-model-configurable-01
  Scenario: a pack's declared coordinator model/effort are applied
    Given a pack config declares coordinator_model claude-sonnet-5 and coordinator_effort high
    When the coordinator is provisioned
    Then it is launched with that model and effort

  # BL-314 coordinator-model-configurable-02
  Scenario: absent coordinator config falls back to a Sonnet-tier default
    Given a pack config declares neither coordinator_model nor coordinator_effort
    When the coordinator is provisioned
    Then it is launched with the default Sonnet-tier model, not Opus

  # BL-314 coordinator-model-configurable-03
  Scenario: a pack may still explicitly opt the coordinator into Opus
    Given a pack config declares coordinator_model claude-opus-4-8
    When the coordinator is provisioned
    Then it is launched with the Opus model as declared

  # BL-314 coordinator-model-configurable-04
  Scenario: the coordinator still cannot be declared as a window line
    Given a pack config declares a window line for the coordinator role
    When the config is parsed
    Then it is rejected exactly as before
