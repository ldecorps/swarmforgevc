Feature: /queue reposts the Host queue selection poll

  The Host bridge's /queue command used to print a scroll of truncated lines.
  It now reposts the existing pick-one selection poll, so a poll that scrolled
  off the topic can be summoned back. These scenarios verify the human-landed
  hotfix e49a71b53, including the one-live-poll guard it deliberately clears.

  Background:
    Given a Host bridge whose Telegram topic is known
    And the bridge is idle

  # BL-894 queue-reposts-selection-poll-01
  Scenario: /queue posts a poll rather than a text list
    Given 2 questions are queued
    When the human sends "/queue"
    Then a selection poll is posted to the Host topic
    And the poll offers one option per queued question plus clear-all
    And no truncated text listing of the queue is posted

  # BL-894 queue-reposts-selection-poll-02
  Scenario: /queue on an empty queue posts no poll
    Given 0 questions are queued
    When the human sends "/queue"
    Then the bridge replies "Queue is empty."
    And no selection poll is posted

  # BL-894 queue-reposts-selection-poll-03
  Scenario: a tap on a superseded poll never vanishes in silence
    Given 2 questions are queued
    And a selection poll is already outstanding
    And the human has sent "/queue"
    And a second selection poll has been posted
    When the human votes on the superseded poll
    Then the human is told that poll is no longer live
    And the queue still holds 2 questions

  # BL-894 queue-reposts-selection-poll-03b
  Scenario: a tap on a poll superseded by TWO reposts never vanishes in silence
    Given 2 questions are queued
    And a selection poll is already outstanding
    And the human has sent "/queue"
    And a second selection poll has been posted
    And the human has sent "/queue"
    And a third selection poll has been posted
    When the human votes on the superseded poll
    Then the human is told that poll is no longer live
    And the queue still holds 2 questions

  # BL-894 queue-reposts-selection-poll-04
  Scenario: a vote on the newest poll runs and dequeues exactly that question
    Given 3 questions are queued
    And the human has sent "/queue"
    When the human votes for question 2 on the newest poll
    Then question 2 runs as the bridge's next turn
    And question 2 leaves the queue
    And the queue still holds 2 questions

  # BL-894 queue-reposts-selection-poll-05
  Scenario Outline: /queue never permanently redefines where polls are posted
    Given the bridge has <recorded_topic> recorded as its Host topic
    When the human sends "/queue" from topic "sidebar"
    And a later auto-present posts a selection poll
    Then that poll is posted to topic "<poll_lands_in>"

    Examples:
      | recorded_topic | poll_lands_in |
      | "host"         | host          |
      | no topic       | host          |
