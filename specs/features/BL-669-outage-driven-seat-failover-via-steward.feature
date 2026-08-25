Feature: outage-driven seat failover consults the Model Steward for certified substitutes
  BL-669 (epic BL-545). Four fifths shipped: signature-backed outage records,
  Model Steward eligible gate, ModelFactory cold-apply, BL-563 launch wiring.
  Missing wire: sustained outage -> coordinator consults steward -> certified
  substitute applied at idle boundary -> auto-revert when outage ends.
  Also register anthropic/claude-opus-4-8 as designated same-provider fallback.
  Governance: auto-apply only unattended + certified-eligible + announced;
  attended hours propose for human confirm. Never --override-uncertified.
  Source: INTAKE-outage-driven-seat-failover-via-steward.md; Opus 5 incident
  fixture.

  Background:
    Given the Model Steward registry includes certified substitutes
    And provider-outage records name affected seats with duration and endedAtUtc

  # BL-669 sustained-outage-consults-steward-01
  Scenario: a sustained outage record triggers steward consultation for the affected seat
    Given an outage record for provider "anthropic" model "claude-opus-5" has exceeded the duration threshold
    And the outage names seat "architect" as affected
    When the coordinator evaluates outage-driven failover
    Then it consults the steward for an assignment-eligible substitute for seat "architect"
    And it does not consult before the duration threshold is met

  # BL-669 swap-only-at-idle-boundary-02
  Scenario: a substitute is applied only at an idle or turn boundary
    Given a certified substitute is available for the affected seat
    And the seat is mid-turn with live work in progress
    When failover would apply the substitute
    Then the swap is deferred until the next idle boundary
    And no respawn into a live turn is performed

  # BL-669 auto-revert-when-outage-closes-03
  Scenario: the seat reverts to the pack canonical model when the outage record closes
    Given a failover swap is active for seat "architect"
    And the outage record sets endedAtUtc
    When the coordinator evaluates reversion at the next idle boundary
    Then the seat reverts to the pack's canonical model for that seat
    And the revert is automatic without a separate human ask

  # BL-669 certified-only-no-override-04
  Scenario: uncertified models are never applied on the outage failover path
    Given the only available substitute for the seat is uncertified
    When the coordinator evaluates outage-driven failover
    Then no substitute is applied
    And --override-uncertified is not used on this path

  # BL-669 swap-announced-and-logged-05
  Scenario: every swap and revert is announced and logged as a COST experiment annotation
    When a failover swap or revert is applied
    Then an Operator-topic announcement names seat from-model to-model incident and revert condition
    And a COST-root experiment-log annotation records the seat change

  # BL-669 opus-4-8-registered-as-fallback-06
  Scenario: anthropic claude-opus-4-8 is registered and certified as same-provider fallback
    Given anthropic/claude-opus-4-8 is not yet in the steward registry
    When the designated fallback registration runs
    Then anthropic/claude-opus-4-8 is present in the registry
    And it is assignment-eligible as the same-provider fallback for opus-class outages
