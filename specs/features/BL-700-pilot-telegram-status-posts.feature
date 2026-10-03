Feature: Cursor /pilot posts Telegram status on ticket, hat, and bounce

  # BL-700: composePilotExpeditorPrompt requires structured Cursor Remote
  # Telegram posts on ticket change, hat/casquette change, and bounce-back
  # (with reason). progress.json / playful SDK status alone are not enough.
  # Pure format helpers shape those three lines. Full native poll send wiring
  # for human questions may still grow; the poll prompt rule from BL-699 stays.
  # Orphan cleanup is BL-701. Automated /expedite stays unchanged.

  Background:
    Given the pilot expeditor prompt composer is available

  # BL-700 pilot-status-04
  Scenario: structured status helpers format the three mandatory events
    When a pilot ticket-change status is formatted for "BL-700" with object "status posts"
    Then the formatted status includes "BL-700" and "status posts"
    When a pilot hat-change status is formatted for role "coder" with job "implement helpers"
    Then the formatted status includes "coder" and "implement helpers"
    When a pilot bounce-back status is formatted toward "specifier" with reason "missing scenarios"
    Then the formatted status includes "specifier" and "missing scenarios"
