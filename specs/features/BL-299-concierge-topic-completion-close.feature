Feature: Concierge posts a completion summary and closes a backlog item's topic when its task completes

  Background:
    Given the Concierge is routing a typed swarm event for a backlog item

  # BL-299 topic-complete-01
  Scenario Outline: routing a <kind> event for an item that <topic-state>
    Given a <kind> event for an item that <topic-state>
    When the Concierge routes the event
    Then it <outcome>

    Examples:
      | kind | topic-state | outcome |
      | completion | has a topic | posts a completion summary naming the item, then closes the topic |
      | progress | has a topic | posts the event and leaves the topic open |
      | completion | has no topic | posts nothing and closes no topic |
