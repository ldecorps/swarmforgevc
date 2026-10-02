Feature: BL-1880 The briefing's bounce line counts since the previous briefing, shows the trend, and names each role's model

  The morning briefing's bounce line (qa-bounce-line.js, BL-454, BL-635,
  BL-689) counts every bounce since the project began: 507 on 2026-10-02.
  The human asked whether that was since the previous briefing. It was not.
  The human wants it scoped since the last email, or at least shown as a
  trend, because it has to support the choice to change a role's model. The
  line now leads with the bounces since the previous briefing, shows a
  seven-day trend per producing role, names the model each role runs now,
  and keeps the all-time total last. The same figures are printed as JSON
  for the coordinator's model advice.

  Background:
    Given a fixture project with a bounce log and a record of when briefings were sent

  # BL-1880 the-line-counts-since-the-previous-briefing-01
  Scenario: the line counts only the bounces after the previous briefing was sent
    Given the previous briefing was sent at 2026-10-01T08:00:00Z
    And the bounce log holds 3 bounces before that time and 2 after it
    When the bounce line is rendered at 2026-10-02T07:00:00Z
    Then the line counts 2 bounces since the previous briefing
    And the line names 2026-10-01T08:00:00Z as the start of that window

  # BL-1880 no-previous-briefing-falls-back-to-a-day-02
  Scenario: with no previous briefing on record the window is the last 24 hours and the line says so
    Given no briefing send is on record
    And the bounce log holds one bounce 30 hours and one 2 hours before 2026-10-02T07:00:00Z
    When the bounce line is rendered at 2026-10-02T07:00:00Z
    Then the line counts 1 bounce in the last 24 hours
    And the line says no previous briefing was found

  # BL-1880 the-trend-shows-each-of-the-last-seven-days-03
  Scenario: the trend shows one count per day for the last seven days per producing role, oldest first
    Given the bounce log holds coder bounces of 1, 0, 2, 0, 3, 1 and 4 on the seven days before 2026-10-02T07:00:00Z
    When the bounce line is rendered at 2026-10-02T07:00:00Z
    Then the coder trend reads 1 0 2 0 3 1 4

  # BL-1880 each-producing-role-names-its-model-04
  Scenario: each producing role in the window is named with the model it runs now
    Given the coder role runs claude-opus-5-5
    And the previous briefing was sent at 2026-10-01T08:00:00Z
    And the bounce log holds a coder bounce after that time
    When the bounce line is rendered at 2026-10-02T07:00:00Z
    Then the coder entry names the coder role's model as the swarm tiles show it

  # BL-1880 the-all-time-total-stays-last-05
  Scenario: the all-time total is kept, last, and labelled all-time
    Given the previous briefing was sent at 2026-10-01T08:00:00Z
    And the bounce log holds 3 bounces before that time and 2 after it
    When the bounce line is rendered at 2026-10-02T07:00:00Z
    Then the line ends with an all-time total of 5

  # BL-1880 the-coordinator-reads-the-same-figures-06
  Scenario: the same figures are printed as JSON for the coordinator's model advice
    Given the previous briefing was sent at 2026-10-01T08:00:00Z
    And the bounce log holds 3 bounces before that time and 2 after it
    When the bounce figures are requested as JSON at 2026-10-02T07:00:00Z
    Then the JSON holds the window start, the window counts by producing and bouncing role, the seven-day trend per producing role, and each producing role's model
    And every count in the JSON equals the count the line prints
