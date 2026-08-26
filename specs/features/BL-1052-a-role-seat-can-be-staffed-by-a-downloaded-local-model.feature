# mutation-stamp: sha256=a783e365b8ef4767624b21f1c30f5b6c008c289e5c76b323efc998f475a53d2c
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-23T21:21:11.243120168Z","feature_name":"A role seat can be staffed by a downloaded local model","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1052-a-role-seat-can-be-staffed-by-a-downloaded-local-model.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":2,"name":"the launch command names the local endpoint and the chosen model","scenario_hash":"ec683b0a5476842d58a3f0eefc76ccd6c25e277017fb7be979704bdc1bcc34b5","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-23T21:21:11.243120168Z"}]}
# acceptance-mutation-manifest-end

Feature: A role seat can be staffed by a downloaded local model

  A seat staffed by a downloaded model runs its completions on this host through
  an agent that really executes shell commands. The aider-based Qwen path
  already in the swarm shares the models but is a file editor that cannot
  execute, so the two must never share a capability shape: a capability entry
  describes the AGENT, not the model.

  Pulling and serving the model is BL-1082; the ModelFactory provider key and
  the Model Steward registration are BL-1053. Neither is asserted here.

  # BL-1052 local-model-seat-01
  Scenario: the local-model seat agent is registered as a shell-capable agent
    When the capabilities for agent "local-model" are read
    Then its wake style is "chat-message"
    And its bootstrap style is "embedded"

  # BL-1052 local-model-seat-02
  Scenario: the aider-based path keeps its own distinct shape
    When the capabilities for agent "aider" are read
    Then its wake style is "shell-run-script"
    And its bootstrap style differs from the shape of agent "local-model"

  # BL-1052 local-model-seat-03
  Scenario Outline: the launch command names the local endpoint and the chosen model
    Given a window line staffing role "coder" with agent "local-model" and model "<model>"
    When the launch command for that window is composed
    Then it targets the local inference endpoint on the loopback interface
    And it selects model "<model>"
    And it enables non-interactive shell execution

    Examples:
      | model                     |
      | qwen2.5-coder:7b-instruct |
      | llama3.1:8b               |

  # BL-1052 local-model-seat-04
  Scenario: the role prompt reaches the launched seat
    Given a window line staffing role "coder" with agent "local-model" and model "qwen2.5-coder:7b-instruct"
    When the launch command for that window is composed
    Then the composed command carries the role's bootstrap prompt

  # BL-1052 local-model-seat-05
  Scenario: the launch command holds no credential value
    Given a credential for the local endpoint is exported in the launching environment
    When the launch command for a "local-model" window is composed
    Then the composed command does not contain the credential value

  # BL-1052 local-model-seat-06
  Scenario: a seat is not launched against an endpoint that is not ready
    Given the local endpoint health check reports not ready
    When a "local-model" window is launched
    Then the launch is refused
    And the refusal names the endpoint that was not ready

  # BL-1052 local-model-seat-07
  Scenario: the new pack staffs every role window with the local-model agent
    When the new local-model pack file is read
    Then every role window names agent "local-model"
    And it requires no cloud provider API key

  # BL-1052 local-model-seat-08
  Scenario: the existing aider-based Qwen pack is left alone
    When the pack file "qwen-mono-router.conf" is read
    Then it still names agent "aider" for every role window
