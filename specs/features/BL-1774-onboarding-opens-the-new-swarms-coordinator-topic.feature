Feature: BL-1774 Onboarding opens the new swarm's Coordinator topic

  Stamp-off of hotfix e5a03ee6c7 (BL-848). A freshly onboarded swarm got
  only the contract-negotiation topic, so with no front desk its
  coordinator had nowhere to reach the human: gpu-bargain-hunter's
  coordinator sat blocked on a human-only action on 2026-09-26 with the
  request visible only in its own tmux pane. The hotfix makes
  provision-onboarding-telegram-channel.js also open a Coordinator forum
  topic and record it as coordinator in the target's
  .swarmforge/operator/role-topic-map.json.

  Every scenario runs ensureCoordinatorTopic against a fixture target
  directory under a temporary root and a fake Bot API, never the live
  checkout and never a real bot token.

  Background:
    Given a fixture target repository under a temporary root
    And a fake Bot API that answers createForumTopic with thread 77

  # BL-1774 leaves-exactly-one-coordinator-topic-recorded-01
  Scenario Outline: the coordinator topic step opens a topic only when the target has none
    Given the target's role-topic-map.json holds <before>
    When the coordinator topic step runs for the target
    Then the fake Bot API opened <opened> topics named "Coordinator"
    And the outcome carries coordinatorTopicId <id>
    And the target's role-topic-map.json holds <after>

    Examples:
      | before                 | opened | id | after                   |
      | QA 9                   | 1      | 77 | coordinator 77 and QA 9 |
      | coordinator 5 and QA 9 | 0      | 5  | coordinator 5 and QA 9  |

  # BL-1774 a-refused-topic-writes-nothing-02
  Scenario: a topic Telegram refuses is reported and nothing is recorded
    Given the target's role-topic-map.json holds QA 9
    And the fake Bot API refuses createForumTopic with "not enough rights to manage topics"
    When the coordinator topic step runs for the target
    Then the outcome carries an error naming "not enough rights to manage topics"
    And the target's role-topic-map.json is unchanged
