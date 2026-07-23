Feature: Operator thread lifecycle — status, no self-close, human-confirm close, optional idle nudge

  Background:
    Given an open Operator subject thread and its idle clock evaluated at a fixed injected time

  # BL-276 thread-lifecycle-01
  Scenario: the Operator never closes a thread of its own will
    Given the human has not asked to close the thread and has been silent for many days
    When the idle clock ticks
    Then the Operator does not close the thread

  # BL-276 thread-lifecycle-02
  Scenario: the human confirming resolution closes the thread
    Given the human confirms the subject is resolved
    When the Operator handles the confirmation
    Then the thread is closed as resolved

  # BL-276 thread-lifecycle-03
  Scenario: an idle thread gets a daily nudge posted into its topic
    Given the human has not participated for a day
    When the idle clock ticks
    Then a nudge is posted into the thread's topic

  # BL-276 thread-lifecycle-04
  Scenario: participation resets the idle clock
    Given a nudge has already been posted
    When the human replies in the topic
    Then the idle clock resets from that reply
