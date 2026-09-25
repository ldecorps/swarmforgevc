Feature: BL-1765 a closing ceremony in progress at local midnight finishes under the night it started
  The ceremony runner keys a night on the local calendar day of each tick.
  A sleep that starts the ceremony shortly before local midnight therefore
  meets a new day on its next tick, abandons the night it started, and
  freezes promotion again for a second night: the first night's briefing
  is never asked for and bedtime runs the drain twice. A night in progress
  keeps the day it started under until its own sleep ceiling (the hard
  deadline plus the fixed grace) has passed. Past that ceiling, and for a
  night already done, the tick's calendar day decides, as before.

  Background:
    Given the night closing ceremony runner over stand-in dependencies

  # BL-1765 ceremony-crosses-midnight-01
  Scenario Outline: a night in progress keeps its day until its own ceiling
    Given a sleep starts the ceremony at local "<start>"
    When the sleep ticks it again <minutes> minutes later
    Then the ceremony's night is "<night>"
    And freeze-promotion appears <freezes> times in its sequence

    Examples:
      | start            | minutes | night      | freezes |
      | 2026-09-25 23:50 | 20      | 2026-09-25 | 1       |
      | 2026-09-25 12:00 | 20      | 2026-09-25 | 1       |
      | 2026-09-25 23:50 | 40      | 2026-09-26 | 2       |
      | 2026-09-25 12:00 | 40      | 2026-09-25 | 1       |

  # BL-1765 ceremony-crosses-midnight-02
  Scenario: the briefing asked for at the deadline is the night the ceremony started
    Given a sleep starts the ceremony at local "2026-09-25 23:50"
    And no briefing is sent for any day
    When the sleep ticks it at its hard deadline
    Then ensure-briefing asks for the briefing of "2026-09-25"
    And the sequence ends with "swarm-stopped"

  # BL-1765 ceremony-crosses-midnight-03
  Scenario: a night already done is never carried into the next day
    Given a finished ceremony for the night of "2026-09-25"
    When the daemon's due sweep ticks at local "2026-09-26 06:10"
    Then the ceremony's night is "2026-09-26"
    And freeze-promotion appears 1 times in its sequence
