Feature: Operator hosts per-subject SUP-### threads as Telegram forum topics (refocus MVP)

  Background:
    Given the Operator hosts SUP-### threads as Telegram forum topics

  # BL-281 telegram-topic-01
  Scenario: opening a subject maps a new SUP-### to its own Telegram topic
    Given the human opens a new subject
    When the Operator runtime creates the thread
    Then a Telegram forum topic is created and mapped one-to-one to a new SUP-###

  # BL-281 telegram-topic-02
  Scenario: an inbound topic message is demuxed to its own SUP-### transcript
    Given an inbound message arrives on a topic mapped to a SUP-###
    When the Operator runtime processes the update
    Then the message is appended to that SUP-###'s transcript
    And a per-topic event is enqueued for that SUP-###

  # BL-281 telegram-topic-03
  Scenario: the Operator replies into the same topic using that thread's reloaded transcript
    Given the disposable Operator is woken for a SUP-### with prior messages in its transcript
    When it handles the wake
    Then it replies into that subject's topic using the thread's reloaded transcript

  # BL-281 telegram-topic-04
  Scenario: parallel subjects stay fully independent
    Given two subjects each on their own topic
    When the Operator handles an event for one subject
    Then it sees only that subject's transcript, never the other subject's

  # BL-281 telegram-topic-05
  Scenario: inbound from anyone other than the principal is ignored
    Given an inbound message from a user who is not the principal
    When the Operator runtime processes the update
    Then the message is ignored and no thread event is enqueued
