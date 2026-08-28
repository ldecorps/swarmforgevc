Feature: a local qwen seat answers in its own dedicated topic, leaving cursor alone

  # BL-1235 (epic local-llm-swarm). Human directive 2026-08-28: "cursor stays
  # behind the usual host topic and front desk. I want local qwen only behind
  # its dedicated one." The seat is a THIRD subject alongside CURSOR_REMOTE and
  # BUBBLE, backed by the named-model serve path BL-1082 already shipped.

  Background:
    Given a dedicated messaging topic reserved for the local model seat
    And a named local model configured for that seat

  # BL-1235 dedicated-topic-answers-locally-01
  Scenario: a message in the dedicated topic is answered by the local model
    Given the local model endpoint is serving that model
    When a message arrives in the dedicated topic
    Then the reply is produced by the local model
    And the reply is posted back into that same topic

  # BL-1235 cursor-topics-are-untouched-02
  Scenario Outline: the local seat never answers on cursor's surfaces
    When a message arrives in the <other_surface>
    Then the local model seat does not answer it
    And that surface is served by the host agent it was already bound to

    Examples:
      | other_surface     |
      | usual host topic  |
      | front desk topic  |

  # BL-1235 endpoint-down-says-why-03
  Scenario: an unavailable local endpoint reports the reason in the topic
    Given the local model endpoint is unreachable
    When a message arrives in the dedicated topic
    Then the topic carries the endpoint's actual failure reason
    And the reply is not a bare status code or a silent drop

  # BL-1235 unknown-model-tag-refuses-visibly-04
  Scenario: a configured model the endpoint does not have refuses visibly
    Given the endpoint is up but does not hold that model
    When a message arrives in the dedicated topic
    Then the topic names the configured model as unavailable
    And no other seat is asked to answer in its place
