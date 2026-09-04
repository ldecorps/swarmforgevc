Feature: BL-1384 The local seat's topic reaches the bridge through the front desk

  The qwen-local seat lives inside the cursor-bridge process, which in
  production drains a file queue the front desk feeds instead of polling
  Telegram itself. The front desk forwards only the cursor-host and Bubble
  topics, so the local seat's topic never arrives and each message to it
  opens a support subject instead. This feature is that the local seat's
  topic is forwarded like the other bridge-owned topics, and that the seat
  then answers through that path.

  Background:
    Given a front desk fixture feeding the cursor bridge inbound queue
    And the local seat topic map binds the local seat to topic 4242

  # BL-1384 a-local-seat-message-is-forwarded-01
  Scenario: a message in the local seat topic is forwarded to the bridge queue
    When a message "hello" arrives in topic 4242
    Then the update is appended to the bridge inbound queue
    And no support subject is opened for topic 4242

  # BL-1384 the-bridge-answers-a-forwarded-message-02
  Scenario: the bridge draining the queue answers in the local seat topic
    Given a message "hello" in topic 4242 is waiting in the bridge inbound queue
    And the local endpoint answers "Hello from qwen"
    When the bridge drains the inbound queue
    Then "Hello from qwen" is posted in topic 4242

  # BL-1384 an-unowned-topic-is-still-not-forwarded-03
  Scenario: a topic the bridge does not own is not forwarded
    When a message "hello" arrives in topic 900
    Then the update is not appended to the bridge inbound queue
    And a support subject is opened for topic 900

  # BL-1384 no-local-seat-means-no-change-04
  Scenario: with no local seat map the front desk behaves as before
    Given the local seat topic map is absent
    When a message "hello" arrives in topic 4242
    Then the update is not appended to the bridge inbound queue
    And a support subject is opened for topic 4242
