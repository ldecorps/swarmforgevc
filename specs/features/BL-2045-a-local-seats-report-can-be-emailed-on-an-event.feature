Feature: BL-2045 A local seat's report can be emailed on an event

  The human asked on 2026-10-06 to be emailed the iq3 seat's health report
  when something noteworthy happens to it, and never on a schedule. The
  report already exists: local_seat_report_cli.bb prints whether a
  local-model seat is generating, idle or down (BL-1842). This slice adds
  one command that sends that report to the configured notify_email_to,
  named for the event that prompted it, so whoever lands a hotfix for the
  seat can send it in one line. A seat's reports are bounded to one email
  per thirty minutes, so a looping caller cannot flood the inbox.

  Background:
    Given a fixture project whose swarmforge.conf sets notify_email_to and whose local-model seat coder reads as idle

  # BL-2045 the-report-is-emailed-for-the-event-01
  Scenario: an event sends one email carrying the seat's report
    When the email command runs for seat coder with the event "hotfix abc1234 landed"
    Then one email is sent to the configured notify_email_to
    And its subject names seat coder, the event "hotfix abc1234 landed" and the state idle
    And its body is the report local_seat_report_cli.bb prints for seat coder

  # BL-2045 a-second-email-within-the-bound-is-suppressed-02
  Scenario: a second event for the same seat within thirty minutes sends nothing
    Given an email for seat coder was sent ten minutes ago
    When the email command runs for seat coder with the event "hotfix def5678 landed"
    Then no email is sent
    And the output says the email was suppressed and names when the next one is allowed

  # BL-2045 no-recipient-sends-nothing-03
  Scenario: a project with no notify_email_to sends nothing and says so
    Given the fixture's swarmforge.conf sets no notify_email_to
    When the email command runs for seat coder with the event "hotfix abc1234 landed"
    Then no email is sent
    And the output says email is not configured
