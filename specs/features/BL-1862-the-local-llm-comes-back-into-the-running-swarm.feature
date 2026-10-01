Feature: BL-1862 The local LLM comes back into the running swarm

  BL-1861's remove takes every local-model seat out of the running swarm
  and unloads its model, so the human can give the local LLM or the GPU
  to a task outside the swarm. Until now the only way back was to put the
  seat's `window` line in the pack and relaunch the whole swarm.
  `local_llm.sh <project-root> add` puts back the seats remove recorded
  in `.swarmforge/local-llm/removed.json`, with the exact roster rows they
  had, and starts each one from its persisted launch script while every
  other seat keeps running. Before it starts anything it checks that the
  model server answers and that the GPU has room for the model, so it
  does not silently contend with the outside task for the one card.

  Background:
    Given a fixture swarm from which local_llm remove took the local-model seats "coder@2" and "coder@iq3"
    And both seats' launch scripts are still in place
    And the stub model server answers and the GPU probe reports 14000 MiB free of 16311 MiB

  # BL-1862 add-restores-and-starts-every-removed-seat-01
  Scenario: add puts back every removed seat and starts it from its launch script
    When the operator runs local_llm add
    Then every roster copy lists "coder@2" and "coder@iq3" again with the exact rows remove took out, in their former places
    And a session for each of "coder@2" and "coder@iq3" is started from its launch script
    And every other session keeps its pane process
    And no removal record remains

  # BL-1862 add-again-says-so-02
  Scenario Outline: add when nothing is removed succeeds and says so
    Given <state>
    When the operator runs local_llm add
    Then it exits 0 and the output says "<message>"
    And no session is started or killed
    And no removal record remains

    Examples:
      | state                                                                                            | message               |
      | the local LLM was already added                                                                  | nothing to add        |
      | a relaunch already put "coder@2" and "coder@iq3" back in the roster and their sessions are running | already in the roster |

  # BL-1862 add-checks-the-gpu-first-03
  Scenario Outline: add refuses while the GPU is held unless forced
    Given the GPU probe reports <free> and the removed model is <loaded> on the stub model server
    When the operator runs local_llm <command>
    Then <outcome>

    Examples:
      | free                       | loaded         | command     | outcome                                                                                   |
      | 2000 MiB free of 16311 MiB | not loaded     | add         | it refuses naming the free memory and the model's recorded size, and changes nothing      |
      | 2000 MiB free of 16311 MiB | not loaded     | add --force | the seats are added and the output warns that the GPU is held                             |
      | 2000 MiB free of 16311 MiB | already loaded | add         | the seats are added                                                                       |
      | no answer                  | not loaded     | add         | the seats are added and the output warns that the GPU occupancy is unknown                |

  # BL-1862 add-refuses-when-the-model-server-is-down-04
  Scenario: add refuses and changes nothing when the model server does not answer
    Given the stub model server is not answering
    When the operator runs local_llm add
    Then it exits non-zero naming the endpoint the seats use
    And no roster copy changes
    And no session is started or killed
    And the removal record is kept

  # BL-1862 add-skips-a-seat-with-no-launch-script-05
  Scenario: a removed seat whose launch script is gone is reported and left out
    Given the launch script of "coder@iq3" has been renamed away
    When the operator runs local_llm add
    Then every roster copy lists "coder@2" again and its session is started
    And no roster copy lists "coder@iq3"
    And the output names "coder@iq3" as not restored because it has no launch script
