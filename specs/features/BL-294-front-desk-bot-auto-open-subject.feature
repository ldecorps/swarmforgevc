Feature: Front Desk Bot opens a subject for DM and new-topic inbound (auto-open)

  Background:
    Given the headless Front Desk Bot polls Telegram for the principal's messages

  # BL-294 auto-open-01
  Scenario: a private DM message is consumed into a single default subject
    Given a principal message in a private direct chat with no topic
    When the bot handles it
    Then it is recorded under a single default subject, not dropped

  # BL-294 auto-open-02
  Scenario: a message on a topic with no subject yet opens one and records the mapping
    Given a principal message on a topic that has no subject mapped yet
    When the bot handles it
    Then a new subject is opened for that topic and the mapping is recorded

  # BL-294 auto-open-03
  Scenario: a later message in the same context reuses the same subject
    Given a context already mapped to a subject
    When the bot handles another message there
    Then it goes to that same subject, without opening a second one

  # BL-294 auto-open-04
  Scenario: a message from anyone but the principal is still dropped
    Given a message from a non-principal user
    When the bot handles it
    Then it is dropped and opens no subject
