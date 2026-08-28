Feature: RC repair gates on the effective config, not only the persisted launch script

  Desired remote-control state for a Claude seat comes from the pack config.
  The persisted launch script records what the seat was launched with, which
  goes stale the moment config is flipped. When config says remote control
  should not be running, every repair path reports the seat off and leaves it
  alone; when config says it should be running (or says nothing at all), the
  existing BL-514 degraded repair and BL-898 session-dead repair are unchanged.

  Background:
    Given a pack whose Claude window lines name an explicit remote-control flag
    And a persisted launch script for role "coder" that still carries that flag

  # BL-1217 rc-repair-gates-on-config-01
  Scenario Outline: a deliberate config off is never repaired, whatever the seat looks like
    Given the pack config sets remote control to "off"
    And the seat "coder" is observed as <observed>
    When a repair pass runs over that seat
    Then the reported status for "coder" is "off"
    And no respawn is attempted for "coder"
    And the repair pass reports success

    Examples:
      | observed             |
      | a live agent that lost its remote-control flag |
      | a live agent whose footer reports the session dead |
      | an agent that is not running at all  |

  # BL-1217 rc-repair-gates-on-config-02
  Scenario Outline: config on preserves today's repair behaviour exactly
    Given the pack config sets remote control to "on"
    And the seat "coder" is observed as <observed>
    When a repair pass runs over that seat
    Then the reported status for "coder" is "<status>"
    And a respawn is attempted for "coder"

    Examples:
      | observed                                           | status       |
      | a live agent that lost its remote-control flag     | degraded     |
      | a live agent whose footer reports the session dead | session-dead |

  # BL-1217 rc-repair-gates-on-config-03
  Scenario: an absent remote-control config behaves exactly as on
    Given the pack config names no remote control setting
    And the seat "coder" is observed as a live agent that lost its remote-control flag
    When a repair pass runs over that seat
    Then the reported status for "coder" is "degraded"
    And a respawn is attempted for "coder"

  # BL-1217 rc-repair-gates-on-config-04
  Scenario: a seat switched off is healthy, not a fault
    Given the pack config sets remote control to "off"
    And the seat "coder" is observed as a live agent that lost its remote-control flag
    When a health report runs without repair
    Then the report exits successfully
    And the report does not name "coder" as needing attention

  # BL-1217 rc-repair-gates-on-config-05
  Scenario: every repair path shares the one gate
    Given the pack config sets remote control to "off"
    And the seat "coder" is observed as a live agent whose footer reports the session dead
    When each available repair entry point runs over that seat in turn
    Then no repair entry point attempts a respawn for "coder"
