Feature: babysitterd recognizes main-sync deadlock and hints the operator

  # BL-1187: handoffd trips main-sync-deadlock once and suppresses coordinator
  # wakes, but spy-only operators miss Telegram. babysitterd reads the deadlock
  # marker each sweep, names overlapping dirty paths when known, escalates to
  # the operator queue, and never nudges the coordinator.

  # BL-1187 deadlock-hint-01
  Scenario: an active main-sync deadlock emits a CRIT operator hint with overlapping paths
    Given main-sync-deadlock is active with reason dirty and ahead 144 behind 593
    And overlapping dirty paths include "backlog/active/BL-709.yaml"
    When the babysitter sweep assesses main-sync deadlock
    Then a CRIT main-sync-deadlock finding is emitted
    And the finding message names the overlapping path
    And the finding message says not to use pilot

  # BL-1187 deadlock-hint-02
  Scenario: main-sync-deadlock findings escalate to the operator but do not nudge the coordinator
    Given main-sync-deadlock is active with reason dirty and ahead 3 behind 1
    When the babysitter sweep assesses main-sync deadlock
    Then the finding is escalation-eligible
    And the finding is not nudge-eligible

  # BL-1187 deadlock-hint-03
  Scenario: no deadlock marker means no main-sync-deadlock finding
    Given main-sync-deadlock is inactive
    When the babysitter sweep assesses main-sync deadlock
    Then no main-sync-deadlock finding is emitted
