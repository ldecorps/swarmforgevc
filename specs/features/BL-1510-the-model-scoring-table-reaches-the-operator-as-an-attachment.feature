Feature: BL-1510 The model-scoring table reaches the operator as a fresh attachment

  The operator wants the current role-matrix scoring - every scored role
  crossed with every model, certified marked - as a properly formatted
  file attachment in the Concierge topic, re-pulled from the steward at
  delivery time and never a stale copy of a hand-made table. This feature
  is a headless renderer that pulls the steward's role-matrix for each
  scored role, writes one table file, and delivers it through the
  document upload BL-1509 built.

  Background:
    Given a model steward registry with certified and candidate models scored on several roles

  # BL-1510 scoring-table-reaches-operator-as-attachment-01
  Scenario: the rendered table has one row per scored role and model, certified marked
    When the scoring report is rendered
    Then the file holds one row for every line the steward's role-matrix returns for each scored role
    And every certified model's row is marked and every candidate's is not
    And each row carries the role, the model, the score and the evidence reference

  # BL-1510 scoring-table-reaches-operator-as-attachment-02
  Scenario: the report is re-pulled at render time, never copied
    Given a first report file written from the registry
    When a model's score changes in the registry and a second report file is written
    Then the second file carries the new score

  # BL-1510 scoring-table-reaches-operator-as-attachment-03
  Scenario: the coordinator is not a scored role and the report says so
    When the scoring report is rendered
    Then no row names the coordinator
    And a footer line states that the steward does not track the coordinator as a role-matrix role

  # BL-1510 scoring-table-reaches-operator-as-attachment-04
  Scenario: the rendered file is delivered to the Concierge topic as a document
    Given a project root whose topic map names the Concierge topic
    When the render-and-send CLI runs
    Then exactly one document upload is made, to that topic, carrying the rendered file
