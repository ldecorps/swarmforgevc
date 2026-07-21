Feature: Model Steward owns model lifecycle knowledge and certification for the swarm

  # BL-547 (human intake 2026-07-21): model knowledge is scattered across pack
  # configs, recruiter scorecards, and operator memory. Model Steward introduces
  # permanent infrastructure for onboarding, benchmarking, certification, and role
  # recommendation. ModelFactory (BL-525) consumes steward artifacts; PromptEngine
  # (BL-546) consumes adapter catalogue entries.
  #
  # SLICE 1 CONTRACT (this file): file-based registries, role matrix, certification
  # status, adapter catalogue schema. Slices 2 (benchmark ingestion) and 3 (steward
  # role + compatibility docs) are parked in
  # BL-547-model-steward-slices-2-3.feature.draft.

  Background:
    Given the Model Steward registry is initialised
    And the committed schema seed exists under swarmforge/model-steward/

  # BL-547 model-registry-entry-01
  Scenario Outline: every supported model has a registry entry with lifecycle status
    Given a model "<model>" from provider "<provider>"
    When the model is registered in the Model Registry
    Then its status is "<status>"
    And its metadata includes context window and cost class

    Examples:
      | provider | model           | status     |
      | anthropic| claude-sonnet-5 | certified  |
      | openai   | gpt-5.3-codex   | certified  |
      | cerebras | llama-3.3-70b   | candidate  |

  # BL-547 capability-registry-dimensions-02
  Scenario: the capability registry records benchmark dimensions per model
    Given a certified model with completed evaluation
    When its capability registry entry is read
    Then it includes scores or flags for coding quality
    And it includes scores or flags for protocol compliance
    And it includes scores or flags for tool usage
    And it includes scores or flags for autonomy
    And it includes scores or flags for cost and latency

  # BL-547 role-recommendation-matrix-03
  Scenario Outline: the role recommendation matrix ranks certified models per swarm role
    Given certified models exist for role "<role>"
    When the role recommendation matrix is queried for "<role>"
    Then the top recommendation is a certified model
    And each ranked entry includes an evidence pointer

    Examples:
      | role       |
      | architect  |
      | coder      |
      | cleaner    |
      | QA         |
      | hardender  |
      | documenter |
      | specifier  |

  # BL-547 prompt-adapter-catalogue-04
  Scenario: the prompt adapter catalogue maps models to PromptEngine adapter ids
    Given a certified model "claude-sonnet-5" on provider "anthropic"
    When the prompt adapter catalogue is queried
    Then it returns PromptEngine adapter id "generic"
    And uncertified candidate models may list candidate adapters but not production defaults

  # BL-547 certification-gate-05
  Scenario: non-certified models are excluded from production role recommendations
    Given a model with status "candidate"
    When ModelFactory requests a production assignment for any role
    Then the candidate model is not recommended
    Unless an explicit operator override permits uncertified models

  # BL-547 certification-records-report-06
  Scenario: certifying a model records a certification report artifact
    Given a candidate model that passed all certification gates
    When an operator certifies the model
    Then its registry status becomes "certified"
    And a certification report artifact path is recorded

  # BL-547 decertify-on-regression-07
  Scenario: a model can be decertified when it regresses below a certification floor
    Given a certified model with a prior certification report
    When a re-evaluation shows regression below the certification floor
    Then its registry status becomes "deprecated" or "candidate"
    And the certification report records the regression reason
