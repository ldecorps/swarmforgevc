Feature: Concierge routes each swarm event into its BL-###'s Telegram topic

  Background:
    Given the Concierge is routing a typed swarm event for a backlog item

  # BL-297 topic-routing-01
  Scenario: the Concierge creates the item's topic once and reuses it after
    Given the item has no topic yet
    When the Concierge routes the event
    Then it creates a topic named for the item and records the backlog-to-topic mapping
    And a later event for the same item posts into that topic, creating no second one

  # BL-297 topic-routing-02
  Scenario: the event goes to the item's topic, never the main group chat
    When the Concierge routes the event
    Then the message goes into the item's topic and never the main group chat

  # BL-297 topic-routing-03
  Scenario: the posted message states the event
    When the Concierge routes the event
    Then the posted message names the event's type
