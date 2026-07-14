Feature: Support conversation threads over RC with an outbound email echo (Support MVP)

  Background:
    Given the Support runtime is handling support conversation threads over remote control

  # BL-275 support-mvp-01
  Scenario: opening a discussion creates a persisted support ticket thread
    Given a caller opens a discussion
    When the Support runtime records the discussion
    Then a new thread is created with its own support ticket id
    And the message is stored under its channel and timestamp with the thread open

  # BL-275 support-mvp-02
  Scenario: the email echo summarizes the thread and states the next step and options
    Given a thread has recorded an interaction
    When Support sends the email echo for the thread
    Then the email subject carries the thread's ticket id and a short title
    And the body summarizes the conversation so far, states the next step, and lists the options

  # BL-275 support-mvp-03
  Scenario: a follow-up is appended to the same thread
    Given an open thread
    When the caller follows up
    Then the follow-up is appended to the same thread

  # BL-275 support-mvp-04
  Scenario: Support does not close a thread on its own
    Given an open thread
    When the Support runtime processes an interaction that is not a close request
    Then Support has not closed the thread
