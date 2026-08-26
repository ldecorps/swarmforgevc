# mutation-stamp: sha256=85cf151df835b763b184c031f2d1795c72609dd856d6cd95dfee6e9de614495b
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-23T18:53:52.568561945Z","feature_name":"The swarm can pull and serve a named model on this host","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1082-the-swarm-can-pull-and-serve-a-named-model-on-this-host.feature","background_hash":"c7b3d1e719b0a13ecc000ccd4756bd27d1fa4a4cb2b25784518d3ee410e56582","implementation_hash":"unknown","scenarios":[{"index":0,"name":"pulling a named model composes a pull for that model id","scenario_hash":"bd3abfeefd4d9496eb4465bbc86a63344aa901588e63890c4f1ae55eebf13123","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-23T18:53:52.568561945Z"}]}
# acceptance-mutation-manifest-end

Feature: The swarm can pull and serve a named model on this host

  The operator names a model; the swarm pulls it onto this host and serves it
  behind a local OpenAI-compatible endpoint, so a seat can run its completions
  on this machine instead of a cloud endpoint. Model identity is a parameter
  throughout: the next model is a different id, never a second adapter.

  Staffing a role seat against that endpoint is BL-1052 and routing work to it
  is BL-1053; neither is asserted here.

  Background:
    Given a host model store configured outside the tracked worktree

  # BL-1082 local-model-pull-serve-01
  Scenario Outline: pulling a named model composes a pull for that model id
    When a pull is requested for model "<model>"
    Then the composed pull names model "<model>"
    And the pull targets the host model store

    Examples:
      | model                     |
      | qwen2.5-coder:7b-instruct |
      | llama3.1:8b               |

  # BL-1082 local-model-pull-serve-02
  Scenario: pulling a model already on the host downloads nothing
    Given model "qwen2.5-coder:7b-instruct" is already present in the host model store
    When a pull is requested for model "qwen2.5-coder:7b-instruct"
    Then no download is started
    And the model is reported as ready

  # BL-1082 local-model-pull-serve-03
  Scenario: a served model answers a health check on a loopback endpoint
    Given the local inference server is serving model "qwen2.5-coder:7b-instruct"
    When the endpoint health is checked
    Then the health check reports ready
    And it names an OpenAI-compatible base URL on the loopback interface

  # BL-1082 local-model-pull-serve-04
  Scenario: an absent server reports not ready rather than reporting nothing
    Given no local inference server is running
    When the endpoint health is checked
    Then the health check reports not ready
    And it names the endpoint it could not reach

  # BL-1082 local-model-pull-serve-05
  Scenario: requesting a serve twice reuses the healthy server
    Given the local inference server is serving model "qwen2.5-coder:7b-instruct"
    When a serve is requested for model "qwen2.5-coder:7b-instruct"
    Then no second server is started
    And the health check reports ready

  # BL-1082 local-model-pull-serve-06
  Scenario: a model id the runtime does not know fails loudly
    When a pull is requested for model "not-a-real-model:0b"
    Then the pull fails
    And the failure names model "not-a-real-model:0b"

  # BL-1082 local-model-pull-serve-07
  Scenario: no path the pull writes is tracked by git
    When a pull is requested for model "qwen2.5-coder:7b-instruct"
    Then no path the pull wrote is tracked by git
