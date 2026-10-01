Feature: BL-1861 The local LLM leaves the running swarm and frees the GPU

  GPU memory is tight. In the 2026-09-30 bake-off the local coder model
  held about 13.1 GB of a 16.3 GB card, and while a local-model seat is
  generating that memory is not available for anything else. The human
  wants to take the local LLM out of the running swarm, give it (or the
  GPU) to a task outside the swarm, and leave the Claude seats working.
  Killing the pane is not enough: the babysitter resurrects a session its
  roster still lists, and the model server keeps the weights until they
  are unloaded. `local_llm.sh <project-root> remove` takes every
  local-model seat out of every roster copy, stops its session, and
  unloads the model those seats name from the model server, which keeps
  running for the outside task. What it took out is written to
  `.swarmforge/local-llm/removed.json`, so that add (BL-1862) can put the
  same seats back.

  Background:
    Given a fixture swarm whose roster lists the Claude seats "coder", "cleaner" and "coordinator" and the local-model seats "coder@2" and "coder@iq3"
    And each local-model seat's launch script names the model "qwen2.5-coder-14b-q5km:latest" on a stub model server
    And the stub model server has "qwen2.5-coder-14b-q5km:latest" loaded

  # BL-1861 remove-takes-out-every-local-seat-01
  Scenario: remove takes every local-model seat out of every roster copy and stops its session
    When the operator runs local_llm remove
    Then no roster copy lists "coder@2" or "coder@iq3"
    And the sessions of "coder@2" and "coder@iq3" are killed only after every roster copy lost their rows
    And the roster rows and sessions of "coder", "cleaner" and "coordinator" are unchanged
    And the removal record names "coder@2" and "coder@iq3" with the rows they had

  # BL-1861 remove-unloads-only-the-swarm-model-02
  Scenario: remove unloads the model the removed seats name and nothing else
    Given the stub model server has "outside-task:latest" loaded
    When the operator runs local_llm remove
    Then "qwen2.5-coder-14b-q5km:latest" is not loaded on the stub model server
    And "outside-task:latest" is still loaded on the stub model server
    And the stub model server is still running
    And the output reports the GPU memory in use after the unload

  # BL-1861 remove-again-says-so-03
  Scenario Outline: remove on a swarm with no local-model seat left succeeds and says so
    Given <state>
    When the operator runs local_llm remove
    Then it exits 0 and the output says "<message>"
    And no roster copy changes
    And "qwen2.5-coder-14b-q5km:latest" is <model_state> on the stub model server

    Examples:
      | state                                                            | message             | model_state  |
      | the local LLM was already removed                                | already removed     | not loaded   |
      | the roster lists no local-model seat and no removal record exists | no local-model seat | still loaded |

  # BL-1861 remove-reports-and-keeps-parcels-04
  Scenario: remove reports every parcel a removed seat holds and moves none
    Given "coder@2" holds a parcel for "BL-9001" in its in_process mailbox and a parcel for "BL-9002" in its new mailbox
    When the operator runs local_llm remove
    Then the output names both parcels with their tickets and mailboxes
    And both parcel files are byte-identical where they were
    And the worktree, branch and mailbox of "coder@2" still exist

  # BL-1861 remove-refuses-a-bare-local-seat-05
  Scenario Outline: remove refuses and changes nothing when a local-model seat is a bare seat
    Given the roster's "<seat>" seat runs on local-model
    When the operator runs local_llm remove
    Then it exits non-zero naming "<seat>"
    And no roster copy changes
    And no session is killed
    And no model is unloaded

    Examples:
      | seat        |
      | coder       |
      | coordinator |

  # BL-1861 remove-says-when-the-model-stays-loaded-06
  Scenario: remove exits non-zero when the model is still loaded after its bounded wait
    Given the stub model server keeps "qwen2.5-coder-14b-q5km:latest" loaded whatever it is asked
    When the operator runs local_llm remove
    Then it exits non-zero naming "qwen2.5-coder-14b-q5km:latest" once the wait bound has passed
    And no roster copy lists "coder@2" or "coder@iq3"
    And the output says to run remove again to retry the unload
