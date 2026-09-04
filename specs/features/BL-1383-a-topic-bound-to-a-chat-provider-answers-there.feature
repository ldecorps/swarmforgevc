Feature: BL-1383 A topic bound to a chat provider answers there

  The operator binds a Telegram forum topic to a direct OpenAI-compatible chat
  provider in a gitignored runtime map. Nothing on main reads that map, so a
  message in a bound topic falls through the front desk's generic path and
  opens a support subject instead of being answered. This feature is that a
  bound topic is decided before the generic flow: the provider's reply, or
  its actual failure reason, lands in the topic and no subject is opened,
  while every unbound topic behaves exactly as it does today.

  Background:
    Given a front desk fixture whose provider chat map binds topic 71550 to a fake provider
    And the fake provider replies "Hello from the seat" to any prompt

  # BL-1383 a-bound-topic-is-answered-01
  Scenario: a message in a bound topic is answered by its provider
    When a message "hello" arrives in topic 71550
    Then an acknowledgement is posted in topic 71550
    And the provider reply "Hello from the seat" is posted in topic 71550
    And no support subject is opened for topic 71550

  # BL-1383 an-unbound-topic-follows-todays-flow-02
  Scenario: a message in an unbound topic is untouched by the seat
    When a message "hello" arrives in topic 900
    Then the fake provider is never called
    And a support subject is opened for topic 900

  # BL-1383 a-provider-failure-is-reported-in-the-topic-03
  Scenario Outline: a failing provider reports its actual reason in the topic
    Given the fake provider fails with <failure>
    When a message "hello" arrives in topic 71550
    Then a message naming <reason> is posted in topic 71550
    And the posted message is not a bare status code
    And no support subject is opened for topic 71550

    Examples:
      | failure                                   | reason                 |
      | status 401 and body "invalid api key"     | "invalid api key"      |
      | a refused connection                      | the refused connection |

  # BL-1383 the-cursor-host-topic-is-never-claimed-04
  Scenario: a topic the cursor bridge owns is forwarded, never answered by the seat
    Given topic 71550 is also the cursor host topic
    When a message "hello" arrives in topic 71550
    Then the update is forwarded to the cursor bridge
    And the fake provider is never called
