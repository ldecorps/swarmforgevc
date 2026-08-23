Feature: The launcher staffs a pack window with a cursor seat

  BL-713 proved a Cursor agent can complete a parcel through a spike CLI.
  Ordinary packs still cannot use it: the launcher's agent whitelist has no
  cursor token, and ensure / poke / wake have no Cursor host process behind
  them, so the spike CLI remains the only way in.

  This slice makes cursor an ordinary launcher token. Steward certification
  is BL-1079 and operator-facing pack lines and how-tos are BL-1080, so
  nothing here decides whether a Cursor seat SHOULD be chosen - only that
  the launcher can staff one when asked.

  # BL-1078 cursor-launcher-token-01
  Scenario Outline: The launcher accepts the agent tokens it supports
    Given a pack window line naming agent <agent>
    When the launcher validates the pack
    Then the window line is <outcome>

    Examples:
      | agent  | outcome  |
      | claude | accepted |
      | cursor | accepted |
      | codex  | accepted |
      | wombat | rejected |

  # BL-1078 cursor-launcher-token-02
  Scenario: Ensure brings up the host process backing a cursor seat
    Given a pack window line naming agent cursor
    When the launcher ensures the window
    Then the Cursor seat host process is running for that window
    And the seat is reachable without the spike CLI

  # BL-1078 cursor-launcher-token-03
  Scenario Outline: A running cursor seat receives launcher signals
    Given a staffed cursor seat
    When the launcher sends <signal> to the window
    Then the seat receives it

    Examples:
      | signal |
      | poke   |
      | wake   |

  # BL-1078 cursor-launcher-token-04
  Scenario: An unsupported agent token names the supported set
    Given a pack window line naming an agent the launcher does not support
    When the launcher validates the pack
    Then the error names the agent tokens the launcher supports
