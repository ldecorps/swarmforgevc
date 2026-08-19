Feature: BL-963 open-slot nudge consults the promotion gate chain

  The open-slot nudge (BL-798) names its candidate from the Article 3.2.4
  ranking alone and fires on a bare count of paused tickets, so once the
  depends_on gate (BL-957) lands it will name candidates promotion refuses,
  fire when nothing is promotable, and accrue false SUP-1 escalations. The
  nudge's naming, fire decision, and escalation tracking must consult the
  one promotion_gates evaluate chain, keeping human_approval as the single
  surfaced-not-filtered refusal.

  Background:
    Given a scratch backlog with an open active slot under the effective depth cap

  # BL-963 nudge-consults-gate-chain-01
  Scenario: a gate-refused top-ranked candidate is skipped in favor of an allowed one
    Given the top-ranked paused ticket is refused by the evaluate chain for an unsatisfied depends_on
    And a lower-ranked paused ticket is allowed by the evaluate chain
    When the open-slot sweep decides its nudge
    Then a nudge fires naming the allowed ticket
    And the gate-refused ticket is not named

  # BL-963 nudge-consults-gate-chain-02
  Scenario: a candidate refused only by human_approval is still named, flagged awaiting approval
    Given the only paused ticket not refused for another reason is refused solely by the human_approval gate
    When the open-slot sweep decides its nudge
    Then a nudge fires naming that ticket flagged awaiting approval

  # BL-963 nudge-consults-gate-chain-03
  Scenario: no nudge fires when every candidate is refused for a reason other than approval
    Given every paused ticket is refused by the evaluate chain for a reason other than human_approval
    When the open-slot sweep decides its nudge
    Then no open-slot nudge fires

  # BL-963 nudge-consults-gate-chain-04
  Scenario: a dependency-refused candidate never advances the escalation counter
    Given the top-ranked paused ticket is refused by the evaluate chain for an unsatisfied depends_on
    And a lower-ranked paused ticket is allowed by the evaluate chain
    When the open-slot sweep decides its nudge on three consecutive ticks
    Then no escalation state is recorded for the gate-refused ticket
