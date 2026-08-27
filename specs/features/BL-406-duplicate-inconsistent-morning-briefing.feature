Feature: the daily morning briefing sends exactly once, consistently rendered

  Background:
    Given the daily morning briefing send path

  # BL-406 briefing-duplicate-inconsistent-01
  Scenario: the daily briefing sends at most once per day
    Given the briefing has already sent successfully today
    When the briefing send path is triggered again the same day
    Then no additional briefing email is sent

  # BL-406 briefing-duplicate-inconsistent-02
  Scenario: a given day's briefing is sent in one consistent language
    Given a single day's briefing send
    When the briefing is composed
    Then the resolved language is the same for that day's send

  # BL-406 briefing-duplicate-inconsistent-03
  Scenario: a given day's briefing consistently includes or omits its diagrams
    Given a single day's briefing send
    When the briefing is composed
    Then the diagram-attachment decision is the same for that day's send
