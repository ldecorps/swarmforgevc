Feature: Operator answers status queries and relays gate decisions from a topic (Decide + Status)

  Background:
    Given the Operator handles a topic message and replies into that same topic

  # BL-285 decide-status-01
  Scenario: a status query is answered in its topic from the live projection
    Given a status query arrives in a topic
    When the Operator handles the query
    Then it replies into that topic with an answer read from the live projection

  # BL-285 decide-status-02
  Scenario: the status answer reflects the projected state, not a fabricated one
    Given a status query about a ticket whose state is known in the projection
    When the Operator handles the query
    Then the reply states that ticket's actual projected state

  # BL-285 decide-status-03
  Scenario: an approval with exactly one pending gate answers that gate
    Given the human approves in a topic
    And exactly one gate is pending
    When the Operator acts on the decision
    Then it answers that pending gate through the gate-answer write path
    And it confirms the outcome in the topic

  # BL-285 decide-status-04
  Scenario: an approval with no pending gate answers nothing
    Given the human approves in a topic
    And no gate is pending
    When the Operator acts on the decision
    Then no gate answer is written
    And it replies that there is nothing to approve

  # BL-285 decide-status-05
  Scenario: an approval with more than one pending gate asks which to answer
    Given the human approves in a topic
    And several gates are pending
    When the Operator acts on the decision
    Then no gate answer is written
    And it asks in the topic which gate to answer
