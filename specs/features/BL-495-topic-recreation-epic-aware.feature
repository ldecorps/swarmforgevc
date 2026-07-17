Feature: The topic recreation repair path targets a ticket's epic or Backlog topic, never a per-ticket topic

  Background:
    Given the topic recreation path repairs a ticket's target topic
    And a ticket's epic membership is read from its epic field

  # BL-495 topic-recreation-epic-aware-01
  Scenario: Recreating an epic-bound ticket's topic targets its epic's topic
    Given a ticket whose epic field names an epic
    When the recreation path is invoked for the ticket
    Then the repair targets that epic's topic
    And the epic topic is reopened when it exists or recreated when it is gone

  # BL-495 topic-recreation-epic-aware-02
  Scenario: Recreating an epic-less ticket's topic targets the standing Backlog topic
    Given a ticket whose epic field is empty
    When the recreation path is invoked for the ticket
    Then the repair targets the standing Backlog topic

  # BL-495 topic-recreation-epic-aware-03
  Scenario: The recreation path never resurrects a per-ticket topic
    Given a ticket that formerly owned a per-ticket topic
    When the recreation path is invoked for the ticket
    Then no per-ticket topic is created
