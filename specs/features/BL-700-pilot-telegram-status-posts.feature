Feature: Cursor /pilot posts Telegram status on ticket, hat, and bounce

  # BL-700: composePilotExpeditorPrompt requires structured Cursor Remote
  # Telegram posts on ticket change, hat/casquette change, and bounce-back
  # (with reason). progress.json / playful SDK status alone are not enough.
  # Pure format helpers shape those three lines. Full native poll send wiring
  # for human questions may still grow; the poll prompt rule from BL-699 stays.
  # Orphan cleanup is BL-701. Automated /expedite stays unchanged.

  Background:
    Given the pilot expeditor prompt composer is available

  # BL-700 pilot-status-01
  Scenario: the /pilot prompt requires Telegram status posts on ticket change
    When the offline expeditor prompt is composed for ticket "BL-700"
    Then the prompt requires a Cursor Remote Telegram post on ticket change
    And the prompt requires the ticket post to include ticket id and object summary

  # BL-700 pilot-status-02
  Scenario: the /pilot prompt requires Telegram status posts on hat change
    When the offline expeditor prompt is composed for ticket "BL-700"
    Then the prompt requires a Cursor Remote Telegram post on hat or casquette change
    And the prompt requires the hat post to name the role and brief stage job

  # BL-700 pilot-status-03
  Scenario: the /pilot prompt requires Telegram status posts on bounce-back with reason
    When the offline expeditor prompt is composed for ticket "BL-700"
    Then the prompt requires a Cursor Remote Telegram post on bounce-back
    And the prompt requires the bounce post to name the target role and explicit reason

  # BL-700 pilot-status-04
  Scenario: structured status helpers format the three mandatory events
    When a pilot ticket-change status is formatted for "BL-700" with object "status posts"
    Then the formatted status includes "BL-700" and "status posts"
    When a pilot hat-change status is formatted for role "coder" with job "implement helpers"
    Then the formatted status includes "coder" and "implement helpers"
    When a pilot bounce-back status is formatted toward "specifier" with reason "missing scenarios"
    Then the formatted status includes "specifier" and "missing scenarios"
