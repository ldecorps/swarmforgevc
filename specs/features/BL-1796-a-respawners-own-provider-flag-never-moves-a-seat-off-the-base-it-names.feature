Feature: BL-1796 A respawner's own provider flag never moves a seat off the base it names

  swarm ensure, handoffd's auth-observe path and babysitterd respawn a
  seat with the environment provider_respawn_env_lib builds. That lib
  reads the SWARMFORGE_USE provider flags from the RESPAWNING process's
  own environment and forces the flagged provider onto every seat it
  respawns. start-swarm-glm.sh exports SWARMFORGE_USE_BAI=1 and
  start-swarm-qwen.sh exports SWARMFORGE_USE_QWEN=1 for the whole
  process tree the daemons inherit. A daemon carrying one of those flags
  moves a local Ollama seat to that cloud provider, and moves a seat on
  another cloud host to the flagged one, whatever the seat's own window
  line names (BL-1793 probe 3a). A seat whose launch script names no base
  keeps today's flag path, which BL-1495's b.ai respawn relies on.

  Background:
    Given the respawning process holds a key for every cloud provider

  # BL-1796 a-local-seat-keeps-its-local-base-01
  Scenario Outline: a local seat keeps its local endpoint whatever flag the respawner carries
    Given a launch script generated for a "<seat>" window line
    And the respawning process sets "<flag>" to 1
    When the respawn environment for that seat is computed
    Then it sets no SWARMFORGE_USE flag and no OpenAI base

    Examples:
      | seat               | flag                      |
      | local Ollama aider | SWARMFORGE_USE_BAI        |
      | local Ollama aider | SWARMFORGE_USE_QWEN       |
      | local Ollama aider | SWARMFORGE_USE_CEREBRAS   |
      | local Ollama aider | SWARMFORGE_USE_PERPLEXITY |
      | local-model        | SWARMFORGE_USE_BAI        |

  # BL-1796 a-cloud-seat-stays-on-the-host-it-names-02
  Scenario Outline: a cloud seat stays on the host its window line names whatever flag the respawner carries
    Given a launch script generated for an aider window line whose OpenAI base is "<host>"
    And the respawning process sets "<other flag>" to 1
    When the respawn environment for that seat is computed
    Then the seat is remapped to "<host>" under the "<flag>" flag
    And it sets no "<other flag>" flag

    Examples:
      | host                                                                   | flag                      | other flag                |
      | https://api.b.ai/v1                                                    | SWARMFORGE_USE_BAI        | SWARMFORGE_USE_QWEN       |
      | https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1 | SWARMFORGE_USE_QWEN       | SWARMFORGE_USE_BAI        |
      | https://api.cerebras.ai/v1                                             | SWARMFORGE_USE_CEREBRAS   | SWARMFORGE_USE_PERPLEXITY |
      | https://api.perplexity.ai                                              | SWARMFORGE_USE_PERPLEXITY | SWARMFORGE_USE_CEREBRAS   |

  # BL-1796 a-seat-naming-no-base-still-takes-the-flag-03
  Scenario: a seat whose launch script names no base still takes the respawner's flag
    Given a launch script generated for a "Claude" window line
    And the respawning process sets "SWARMFORGE_USE_BAI" to 1
    When the respawn environment for that seat is computed
    Then the seat is remapped to "https://api.b.ai/v1" under the "SWARMFORGE_USE_BAI" flag
