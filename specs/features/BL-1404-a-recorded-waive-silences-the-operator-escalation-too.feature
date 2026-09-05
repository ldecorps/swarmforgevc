Feature: BL-1404 A recorded waive silences the operator escalation too

  A babysitter finding over permanent history can be closed by a recorded
  waive. Today the waive stops the coordinator nudge and leaves the operator
  escalation deciding from the raw findings, so a closed finding keeps waking
  the operator every cooldown. This feature is that one recorded waive
  silences both channels for exactly the key it names, on the record, and
  that an unusable store still escalates rather than going quiet.

  Background:
    Given a babysitter sweep holding a CRIT finding keyed on a commit sha
    And an empty escalation dedup state

  # BL-1404 a-waived-finding-does-not-escalate-01
  Scenario: a waived finding wakes nobody and is reported as waived
    Given the finding's key is recorded in the waive store
    When the sweep decides nudges and escalations
    Then no operator escalation is enqueued for that key
    And no coordinator nudge is sent for that key
    And the sweep log reports that key as waived

  # BL-1404 an-unwaived-finding-still-escalates-02
  Scenario: an un-waived finding still escalates
    Given the waive store records nothing for the finding's key
    When the sweep decides nudges and escalations
    Then an operator escalation is enqueued for that key

  # BL-1404 a-waive-suppresses-only-its-own-key-03
  Scenario: a waive suppresses only the key it names
    Given a second CRIT finding keyed on a different commit sha
    And only the first finding's key is recorded in the waive store
    When the sweep decides nudges and escalations
    Then an operator escalation is enqueued for the second key only

  # BL-1404 an-unusable-store-escalates-everything-04
  Scenario: an unusable waive store escalates rather than going quiet
    Given the waive store is unreadable
    When the sweep decides nudges and escalations
    Then an operator escalation is enqueued for that key
    And the sweep log says the waive store was unusable
