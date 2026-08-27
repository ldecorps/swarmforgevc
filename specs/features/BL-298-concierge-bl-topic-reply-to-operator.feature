Feature: Human replies in a BL-### topic reach the Operator as that task's context

  Background:
    Given a principal reply arrives in a Telegram topic that the Concierge must route

  # BL-298 topic-reply-01
  Scenario: a reply in a backlog item's topic reaches the Operator as that item's context
    Given the topic maps to a backlog item
    When the Concierge routes the reply
    Then it reaches the Operator as context for that backlog item
    And it does not touch any support discussion thread

  # BL-298 topic-reply-02
  Scenario: a reply in a support subject's topic still appends to its support thread
    Given the topic maps to a support subject
    When the Concierge routes the reply
    Then it is appended to that support subject's thread

  # BL-298 topic-reply-03
  Scenario: a reply from a non-principal is dropped
    Given the reply is from a non-principal user
    When the Concierge routes the reply
    Then it is dropped and reaches neither the Operator nor a thread
