Feature: Operator proactively notifies the right subject topic (Notify slice)

  Background:
    Given the runtime can deliver a proactive notice over the built reply-outbox bridge egress

  # BL-284 proactive-notify-01
  Scenario: a proactive notice reaches only its subject's topic with no inbound first
    Given two subjects each with an open topic and no pending inbound message
    When the runtime raises a proactive notice for the first subject
    Then the first subject's topic receives the notice
    And the second subject's topic receives nothing

  # BL-284 proactive-notify-02
  Scenario: a proactive notice travels the reply-outbox egress, not a direct Telegram call
    Given the Operator has a subject notice ready to send
    When the notice is emitted
    Then it is appended to the reply outbox tagged for that subject and relayed to the topic over the bridge
    And the runtime makes no direct Telegram call

  # BL-284 proactive-notify-03
  Scenario: a status change concerning a subject triggers exactly one proactive notice
    Given a status change concerning a subject that has an open topic
    When the runtime evaluates whether to notify
    Then it emits exactly one proactive notice for that subject

  # BL-284 proactive-notify-04
  Scenario: nothing relevant changed, so no notice is emitted
    Given a subject whose status has not changed
    When the runtime evaluates whether to notify
    Then the runtime stays silent
