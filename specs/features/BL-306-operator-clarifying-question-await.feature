Feature: The Operator asks the human a clarifying question in the front-desk thread and waits for the answer without getting stuck

  Background:
    Given the Operator has a decision it may not make on its own and asks the human

  # BL-306 operator-ask-01
  Scenario: asking posts the question to the front-desk thread and records an awaiting-answer state
    When the Operator asks its clarifying question
    Then the question is posted into the front-desk support thread
    And an awaiting-answer state is recorded so it is not asked again

  # BL-306 operator-ask-02
  Scenario: a human reply in that thread resolves the pending question
    Given the Operator is awaiting an answer
    When the human replies in the front-desk thread
    Then the reply is delivered to the Operator as that question's answer
    And the awaiting-answer state is cleared

  # BL-306 operator-ask-03
  Scenario: an unanswered question escalates once and then stops waiting
    Given the Operator is awaiting an answer
    When the await window elapses with no reply
    Then the question is escalated once and the Operator stops waiting on it
    And the Operator never guesses the answer on its own

  # BL-306 operator-ask-04
  Scenario: waiting on an answer does not block emergency recovery
    Given the Operator is awaiting an answer
    When a swarm emergency needs handling
    Then the Operator still handles the emergency
