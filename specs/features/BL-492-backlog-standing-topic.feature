Feature: A standing Backlog catch-all topic is ensured once at boot for epic-less tickets

  Background:
    Given the front desk ensures its standing topics at boot

  # BL-492 backlog-standing-topic-01
  Scenario: Booting with no Backlog topic creates one under the reserved Backlog subject
    Given no topic is yet recorded for the reserved Backlog subject
    When the front desk ensures its standing topics at boot
    Then a Backlog topic is created
    And its id is recorded under the reserved Backlog subject

  # BL-492 backlog-standing-topic-02
  Scenario: Booting with an existing Backlog topic reuses it and creates nothing
    Given a topic id is already recorded for the reserved Backlog subject
    When the front desk ensures its standing topics at boot
    Then the recorded Backlog topic id is reused
    And no new Backlog topic is created

  # BL-492 backlog-standing-topic-03
  Scenario: Ensuring the Backlog topic leaves the STEERING and other standing topics untouched
    Given the per-role STEERING topics and other standing topics already exist
    When the front desk ensures its standing topics at boot
    Then the existing STEERING and other standing topics are unchanged
