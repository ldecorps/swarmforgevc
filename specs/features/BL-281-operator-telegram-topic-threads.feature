Feature: Telegram front-desk Talk MVP over the bridge (bot is a bridge client)

  Background:
    Given the front desk runs as a Telegram bot that is a client of the bridge

  # BL-281 telegram-topic-01
  Scenario: an inbound topic message is ingested by the bridge as a per-SUP-### event
    Given an inbound Telegram message on a topic mapped to a SUP-###
    When the Front Desk Bot posts it to the bridge inbound-message route
    Then the bridge ingests it and enqueues a per-SUP-### event

  # BL-281 telegram-topic-02
  Scenario: the bridge inbound-message route requires authorization
    Given an unauthorized request to the bridge inbound-message route
    When the bridge receives it
    Then the request is rejected

  # BL-281 telegram-topic-03
  Scenario: the Operator's reply flows out over SSE and the bot posts it into the same topic
    Given the disposable Operator is woken for a SUP-### with prior messages in its transcript
    When it handles the wake and writes a reply
    Then the reply flows out over the bridge SSE stream to the bot
    And the bot posts it into that subject's topic

  # BL-281 telegram-topic-04
  Scenario: parallel subjects stay fully independent
    Given two subjects each on their own topic
    When the Operator handles an event for one subject
    Then it sees only that subject's transcript, never the other subject's

  # BL-281 telegram-topic-05
  Scenario: inbound from anyone other than the principal is dropped at the bot
    Given a Telegram message from a user who is not the principal
    When the Front Desk Bot processes updates
    Then the message is not posted to the bridge
