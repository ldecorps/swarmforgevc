Feature: BL-1703 a pack with a local model endpoint starts and probes ollama before it launches

  ollama serve is started by hand on this host and nothing supervises
  it. No launch path probes the local endpoint, so a dead server passes
  every gate and each aider seat then fails at its first request. A
  launch of any pack whose seats use the local model endpoint now probes
  it first: an answering endpoint is used as it is and recorded as
  external; a silent one is started by the swarm, waited for, and
  recorded as swarm-owned; one that never answers refuses the launch
  before any seat starts. Packs with no local endpoint launch exactly as
  before. The scenarios use a stand-in ollama binary and endpoint.

  Background:
    Given a throwaway project whose launch uses a stand-in ollama binary

  # BL-1703 a-pack-with-a-local-model-endpoint-starts-and-probes-ollama-01
  Scenario Outline: the launch probes the local endpoint and records who owns the server
    Given the pack's seats use the local model endpoint
    And the endpoint <state>
    When the pack is launched
    Then the launch <result>
    And the ollama record says "<owner>"

    Examples:
      | state                                          | result                                              | owner         |
      | already answers                                | proceeds without starting a server                  | external      |
      | is silent until the swarm starts the server    | starts the server once and proceeds when it answers | swarm-owned   |
      | never answers within the wait                  | refuses before any seat starts, naming the endpoint | none          |

  # BL-1703 a-pack-with-a-local-model-endpoint-starts-and-probes-ollama-02
  Scenario: a server the swarm started for a refused launch is stopped again
    Given the pack's seats use the local model endpoint
    And the endpoint never answers within the wait
    When the pack is launched
    Then no ollama process the launch started is still running

  # BL-1703 a-pack-with-a-local-model-endpoint-starts-and-probes-ollama-03
  Scenario: a pack with no local model endpoint launches without any probe
    Given the pack's seats all run Claude
    When the pack is launched
    Then no endpoint probe ran, no ollama process was started and no ollama record exists
