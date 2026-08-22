Feature: A hydrate run boots on the specifier and stays there

  Mono-router makes coder the home resident on purpose, so cold unspecced
  intake wakes nobody and the first mail for coder pulls the resident off
  specifier and starts building - the one thing a hydrate run must not do.
  A dedicated hydrate pack pins the resident mechanically, because note
  discipline demonstrably did not hold.

  The automatic drain-stop when the specifier hands work to the coder is
  BL-1055 and is asserted nowhere here.

  Background:
    Given a swarm launched with the hydrate pack

  # BL-1054 hydrate-resident-lock-01
  Scenario: the single resident boots as the specifier
    Then the resident role is "specifier"
    And no coder pane exists

  # BL-1054 hydrate-resident-lock-02
  Scenario Outline: the resident runs the specifier's own launch settings, not the coder's
    Then the resident pane uses the "<setting>" the pack declares for "specifier"

    Examples:
      | setting |
      | model   |
      | effort  |

  # BL-1054 hydrate-resident-lock-03
  Scenario Outline: every rotation path is refused while the lock is held
    When a rotation to "<target>" is requested by "<path>"
    Then the rotation is refused
    And the refusal is logged
    And the resident role is "specifier"

    Examples:
      | target     | path         |
      | coder      | chase        |
      | coder      | direct       |
      | QA         | direct       |
      | documenter | aged note    |
      | coder      | rotate home  |

  # BL-1054 hydrate-resident-lock-04
  Scenario: a rotation to the locked role itself is not refused
    When a rotation to "specifier" is requested by "direct"
    Then the rotation is allowed
    And the resident role is "specifier"

  # BL-1054 hydrate-resident-lock-05
  Scenario: the lock lives in the pack, not on disk
    When the swarm is stopped
    Then no lock state remains under ".swarmforge/"

  # BL-1054 hydrate-resident-lock-06
  Scenario: an ordinary mono-router run is unaffected
    Given the swarm is relaunched with the ordinary mono-router pack
    Then the resident role is "coder"
    And a rotation to "specifier" is allowed
