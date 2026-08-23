# mutation-stamp: sha256=95a8608b5a17238b22c467f110191f9b4453fe2d7d97b32dba21f6a841c14a7d
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-23T19:47:05.772530518Z","feature_name":"A documented Qwen credential name is honored by the launch guard","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1077-a-documented-qwen-credential-name-is-honored.feature","background_hash":"874bf08cd26830362eb257929ce744a4c3c6e81d7fe22e8530b9dc9bbeff8837","implementation_hash":"unknown","scenarios":[{"index":0,"name":"every accepted credential name reaches the pane","scenario_hash":"298df9c7856ba5c9ef56db118acae07f9bda7b745dc6f9250195e203f9cc5ace","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-23T18:53:10.531989818Z"},{"index":3,"name":"the branch for a pack carrying no endpoint accepts the same names","scenario_hash":"0c6edea5b2f062807dc3ca631d16f2ebbea9eb2bc505b4c5c4539bb732249062","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-23T18:53:10.531989818Z"}]}
# acceptance-mutation-manifest-end

Feature: A documented Qwen credential name is honored by the launch guard

  The Qwen packs tell the operator to export BAILIAN_TOKEN_PLAN_API_KEY as the
  preferred credential, but the launch guard the swarm generates falls back
  only from BAILIAN_CODING_PLAN_API_KEY. A host whose only Qwen credential is
  the documented one therefore launches nothing, and is told that a variable
  it was never asked to set is missing.

  start-swarm-qwen.sh and ancillary_provider_lib.sh already accept the
  documented name; only the generated launch guard does not. This closes that
  gap on both of the guard's branches and makes its refusal name every
  variable it actually accepts, so the message can no longer mislead.

  Background:
    Given no Qwen-family credential is present in the launching environment

  # BL-1077 qwen-credential-name-01
  Scenario Outline: every accepted credential name reaches the pane
    Given "<key>" is exported with a fixture credential
    When the launch guard for a pack whose CLI carries the Token Plan endpoint runs
    Then the OpenAI-compatible key is set to that fixture credential
    And the OpenAI-compatible base URL is the Token Plan endpoint

    Examples:
      | key                         |
      | QWEN_API_KEY                |
      | BAILIAN_TOKEN_PLAN_API_KEY  |
      | BAILIAN_CODING_PLAN_API_KEY |

  # BL-1077 qwen-credential-name-02
  Scenario: an explicit QWEN_API_KEY is never displaced by a fallback
    Given "QWEN_API_KEY" is exported with a fixture credential
    And "BAILIAN_TOKEN_PLAN_API_KEY" is exported with a different fixture credential
    When the launch guard for a pack whose CLI carries the Token Plan endpoint runs
    Then the OpenAI-compatible key is set to the QWEN_API_KEY fixture credential

  # BL-1077 qwen-credential-name-03
  Scenario: the refusal names every accepted variable
    When the launch guard for a pack whose CLI carries the Token Plan endpoint runs
    Then the guard refuses to launch
    And the refusal message names every accepted credential variable

  # BL-1077 qwen-credential-name-04
  Scenario Outline: the branch for a pack carrying no endpoint accepts the same names
    Given the pack opts into Qwen through the environment flag
    And "<key>" is exported with a fixture credential
    When the launch guard for a pack whose CLI carries no endpoint URL runs
    Then the OpenAI-compatible key is set to that fixture credential

    Examples:
      | key                         |
      | QWEN_API_KEY                |
      | BAILIAN_TOKEN_PLAN_API_KEY  |
      | BAILIAN_CODING_PLAN_API_KEY |
