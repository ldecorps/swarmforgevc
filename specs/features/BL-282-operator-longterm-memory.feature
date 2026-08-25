Feature: Operator long-term memory — distill durable facts and reload them per wake

  Background:
    Given the Operator keeps a long-term memory store separate from the per-subject transcripts

  # BL-282 operator-memory-01
  Scenario: distilled durable facts survive into a later disposable Operator run
    Given a disposable Operator run distilled a durable fact from a subject it handled
    When a later wake starts a new disposable Operator run
    Then the earlier durable fact is available to the new run

  # BL-282 operator-memory-02
  Scenario: a wake reloads the stored fact alongside the subject's transcript
    Given the long-term memory store holds a durable fact
    And the subject has its own transcript
    When the Operator is woken for that subject
    Then it loads the durable fact together with the subject's transcript

  # BL-282 operator-memory-03
  Scenario: reloading memory for one subject never surfaces another subject's transcript
    Given subject A holds private transcript detail that was never distilled into a durable fact
    When the Operator reloads a different subject's context
    Then the context holds the durable fact but never subject A's transcript

  # BL-282 operator-memory-04
  Scenario: distillation keeps only generalizable facts and drops raw messages
    Given the Operator has finished handling a subject exchange
    When it distills memory from that exchange
    Then the distilled result keeps only durable generalizable facts
    And the raw subject messages are dropped

  # BL-282 operator-memory-05
  Scenario: re-distilling a known fact does not duplicate it
    Given the long-term memory store holds a durable fact
    When the Operator distills that same fact again
    Then the store still holds it exactly once
