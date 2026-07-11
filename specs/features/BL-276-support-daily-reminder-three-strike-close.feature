Feature: Support daily reminder clock and 3-strike close (Support slice 2)

  Background:
    Given an open Support thread and the reminder clock evaluated at a fixed injected time

  # BL-276 support-reminder-01
  Scenario: a daily reminder is due after a day of caller silence
    Given the caller has not participated for a day
    When the reminder clock ticks
    Then a daily reminder is sent for the thread

  # BL-276 support-reminder-02
  Scenario: caller participation resets the reminder counter
    Given a reminder has already been sent
    When the caller replies on any channel
    Then the reminder counter resets to zero

  # BL-276 support-reminder-03
  Scenario: the third unanswered reminder is a final 24-hour close notice
    Given two daily reminders have gone unanswered
    When the next reminder is due
    Then the third reminder is sent as a final notice that the thread will close in 24 hours

  # BL-276 support-reminder-04
  Scenario: continued silence after the final notice closes the thread as abandoned
    Given a final close notice was sent and the caller stayed silent for 24 more hours
    When the reminder clock ticks
    Then the thread is closed as abandoned

  # BL-276 support-reminder-05
  Scenario: the caller asking to close ends the thread
    Given the caller asks to close the thread
    When Support handles the request
    Then the thread is closed at the caller's request
