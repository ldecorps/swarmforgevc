Feature: One definition of a mid-turn pane

  BL-970 funnels the four wake predicates into a single classifier in
  chase_sweep_lib, and that holds. Two other consumers classify pane text
  themselves and never reach it: the babysitter health check, and the
  endless-loop detector that feeds the circuit breaker.

  Both carry the same whole-pane substring match BL-970 exists to fix, so a
  pane sitting idle whose scrollback merely quotes the busy footer reads as
  mid-turn. In the loop detector that is worse than a wrong status: busy
  means do not strike, so a quoted marker holds the circuit breaker open and
  an endless idle spin is never caught.

  # BL-996 idle-pane-with-a-quoted-marker-01
  Scenario Outline: An idle pane whose scrollback only quotes the marker is idle everywhere
    Given a pane resting at the idle prompt whose scrollback quotes the busy footer
    When <consumer> classifies that pane
    Then the pane is classified idle

    Examples:
      | consumer                    |
      | the wake gate               |
      | the babysitter health check |
      | the endless-loop detector   |

  # BL-996 live-mid-turn-pane-02
  Scenario Outline: A pane genuinely mid-turn is busy everywhere
    Given a pane rendering a live turn-status frame
    When <consumer> classifies that pane
    Then the pane is classified busy

    Examples:
      | consumer                    |
      | the wake gate               |
      | the babysitter health check |
      | the endless-loop detector   |

  # BL-996 circuit-breaker-is-not-held-open-03
  Scenario: A quoted marker does not hold the endless-loop breaker open
    Given a pane spinning on repeated NO_TASK whose scrollback quotes the busy footer
    When the endless-loop detector classifies that pane
    Then the signal is a no-task spin
    And the strike is recorded

  # BL-996 deliberate-exclusions-survive-04
  Scenario: The loop detector still refuses to read an API-wait line as busy
    Given a pane spinning on repeated NO_TASK while showing a model API wait line
    When the endless-loop detector classifies that pane
    Then the signal is a no-task spin
