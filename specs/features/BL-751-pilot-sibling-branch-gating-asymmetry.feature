Feature: sibling-branch gating asymmetry is caught on /pilot land and in hardener guidance

  # BL-751: BL-646 added :warn-fixture-droppings without the elapsed-pct grace
  # gate its head-unchanged? siblings share. Harden hardener guidance and the
  # /pilot land gate so a new multi-arm cond branch cannot land without an
  # explicit decision when it omits a guard ≥2 siblings already share.

  Background:
    Given the pilot expeditor prompt composer is available

  # BL-751 sibling-gating-01
  Scenario: the hardener role prompt requires sibling-branch gating comparison
    When the hardener role prompt is read
    Then it requires comparing new multi-branch arms against sibling guard patterns

  # BL-751 sibling-gating-02
  Scenario: the /pilot prompt requires the same sibling gating rule for the hardener hat
    When the offline expeditor prompt is composed for ticket "BL-751"
    Then the prompt requires comparing new multi-branch arms against sibling guard patterns

  # BL-751 sibling-gating-03
  Scenario: A land whose touched dispatch omits a shared sibling guard refuses
    Given the run's commits touched a multi-arm cond with sibling gating asymmetry
    When the pilot runs the landing gate
    Then the land is refused for sibling-branch gating asymmetry
    And the refusal names the arm missing the shared guard

  # BL-751 sibling-gating-04
  Scenario: Aligned sibling guards let the land complete
    Given the run's commits touched a multi-arm cond with aligned sibling guards
    When the pilot runs the landing gate
    Then the land is completed

  # BL-751 sibling-gating-05
  Scenario: A refused sibling-gating land writes nothing durable
    Given the run's commits touched a multi-arm cond with sibling gating asymmetry
    When the pilot runs the landing gate
    Then the land is refused for sibling-branch gating asymmetry
    And the ticket yaml stays where it was
    And no acceptance receipt is written

  # BL-751 sibling-gating-06
  Scenario: The check is a no-op when the run touches no multi-arm gating dispatch
    Given the run's commits touched no multi-arm cond with three or more predicate arms
    When the pilot runs the landing gate
    Then the land is completed
