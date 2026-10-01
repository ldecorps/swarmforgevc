Feature: BL-1863 The operator adds or removes the local LLM from Telegram or Cursor

  The human asked for verbs that make it easy to take the local LLM out
  of the running swarm and put it back. BL-1861 and BL-1862 give the
  shell pair `local_llm.sh <project-root> remove|add`, but a script whose
  path must be remembered is the floor, not the ceiling. The BL-698
  operator surface already carries the swarm's control verbs on Telegram
  and Cursor. `/localllm remove` and `/localllm add` run the shell pair
  behind one Confirm tap and reply with its output, `/localllm add force`
  passes the GPU override, and a bare `/localllm` (or `/localllm status`)
  says whether the local LLM is in the swarm without asking for a
  confirm. `local_llm.sh <project-root> status` is the shell side of that
  read.

  # BL-1863 localllm-verbs-carry-their-tier-01
  Scenario Outline: each /localllm verb carries its danger tier
    When the operator verb "<verb>" is classified
    Then its danger tier is "<tier>"

    Examples:
      | verb                | tier |
      | /localllm remove    | soft |
      | /localllm add       | soft |
      | /localllm add force | soft |
      | /localllm           | read |
      | /localllm status    | read |

  # BL-1863 a-confirmed-verb-runs-the-script-02
  Scenario Outline: a confirmed /localllm verb runs the shell pair and relays its output
    Given the local_llm script stub prints "<output>" and exits <code>
    When the operator confirms "<verb>"
    Then the local_llm script ran with the project root and "<args>"
    And the reply carries "<output>" and says the run <result>

    Examples:
      | verb                | args        | output                         | code | result    |
      | /localllm remove    | remove      | removed coder@2                | 0    | succeeded |
      | /localllm add       | add         | refused: GPU has 2000 MiB free | 1    | failed    |
      | /localllm add force | add --force | added coder@2                  | 0    | succeeded |

  # BL-1863 a-bare-verb-reads-the-state-03
  Scenario: a bare /localllm relays the state without asking for a confirm
    Given the local_llm script stub prints "local LLM removed at 2026-10-01T09:00Z: coder@2" for status
    When the operator sends "/localllm"
    Then no confirm is asked
    And the local_llm script ran with the project root and "status"
    And the reply carries "local LLM removed at 2026-10-01T09:00Z: coder@2"

  # BL-1863 an-unknown-subcommand-gets-the-usage-04
  Scenario: an unknown /localllm subcommand gets the usage and runs nothing
    When the operator sends "/localllm unplug"
    Then the reply lists "remove", "add", "add force" and "status"
    And the local_llm script did not run

  # BL-1863 status-says-where-the-local-llm-is-05
  Scenario Outline: local_llm status says whether the local LLM is in the swarm
    Given <state>
    When the operator runs local_llm status
    Then it exits 0 and the output says "<message>"
    And no file under the fixture root changes

    Examples:
      | state                                                                               | message                                    |
      | the removal record names "coder@2", removed at 2026-10-01T09:00:00Z                 | removed at 2026-10-01T09:00:00Z: coder@2   |
      | the roster lists the local-model seat "coder@2" and no removal record exists        | in the swarm: coder@2                      |
      | the roster lists no local-model seat and no removal record exists                   | no local-model seat                        |
