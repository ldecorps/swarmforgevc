Feature: Queued bridge questions answer in the topic they were asked in

  A question typed into a bridge-owned Telegram topic while the bridge is
  already working a turn is queued, acknowledged where it was typed, and run
  later. Its answer, and the busy cue that says it is still waiting, must come
  back to that same topic.

  Background:
    Given the Cursor Remote topic and the Bubble topic are both bridge-owned
    And the bridge is already working a turn

  # BL-767 queued-question-answers-in-origin-topic-01
  Scenario Outline: a queued question is answered where it was asked
    When the human posts a question in the <origin> topic
    Then the queue acknowledgement is posted to the <origin> topic
    When the bridge finishes its turn and drains the queue
    Then the answer is posted to the <origin> topic

    Examples:
      | origin        |
      | Cursor Remote |
      | Bubble        |

  # BL-767 queued-question-answers-in-origin-topic-02
  Scenario: a question queued before origin topics were recorded answers on the Cursor Remote topic
    Given a queued question was recorded without an origin topic
    When the bridge finishes its turn and drains the queue
    Then the answer is posted to the Cursor Remote topic

  # BL-767 queued-question-answers-in-origin-topic-03
  Scenario: the busy cue reaches the topic holding the queued question
    When the human posts a question in the Bubble topic
    Then the busy cue in the Bubble topic reports 1 waiting
    When the bridge finishes its turn and drains the queue
    Then the busy cue in the Bubble topic reports 0 waiting

  # BL-767 queued-question-answers-in-origin-topic-04
  Scenario: a queued question is answered in exactly one topic
    When the human posts a question in the Bubble topic
    And the bridge finishes its turn and drains the queue
    Then no answer is posted to the Cursor Remote topic
