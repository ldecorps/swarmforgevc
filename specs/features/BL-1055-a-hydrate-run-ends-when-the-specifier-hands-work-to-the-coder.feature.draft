Feature: A hydrate run ends when the specifier hands work to the coder

  BL-698 pinned the rule that the coder does not start on a hydrate run, and
  BL-1054 keeps the resident on the specifier. Neither acts on the handoff
  that means the drain is finished, so a completed run is indistinguishable
  from one still working.

  Background:
    Given a swarm launched with the hydrate pack

  # BL-1055 hydrate-drain-stop-01
  Scenario: the specifier's handoff to the coder ends the run
    When the specifier sends a git handoff to the coder
    Then the swarm drain-stops
    And no coder pane was ever started

  # BL-1055 hydrate-drain-stop-02
  Scenario: the handoff that ends the run is delivered first
    When the specifier sends a git handoff to the coder
    Then that handoff is durable in the coder mailbox before the swarm stops

  # BL-1055 hydrate-drain-stop-03
  Scenario Outline: only a handoff to a building role ends the run
    When the specifier sends a "<type>" to "<recipient>"
    Then the swarm <outcome>

    Examples:
      | type        | recipient   | outcome        |
      | git handoff | coder       | drain-stops    |
      | note        | coordinator | keeps running  |

  # BL-1055 hydrate-drain-stop-04
  Scenario: an ordinary run is unaffected by the same handoff
    Given the swarm is relaunched with the ordinary mono-router pack
    When the specifier sends a git handoff to the coder
    Then the swarm keeps running
