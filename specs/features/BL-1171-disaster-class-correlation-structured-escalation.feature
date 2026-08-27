Feature: disaster-class correlation produces one structured escalation

  # BL-1171 (epic BL-1168): correlate handoffd + proc-* + swarm-starved into
  # one failure_class escalation with suggested_actions and evidence_paths.

  Background:
    Given babysitterd checks report multiple correlated findings in one sweep

  # BL-1171 one-disaster-class-escalation-01
  Scenario: correlated half-launch handoffd down and swarm-starved emit one structured escalation
    Given handoffd is down and at least three roles are half-launch and the swarm is starved
    When the babysitter sweep completes
    Then exactly one disaster-class escalation is emitted for the incident window
    And the escalation carries failure_class starvation-cascade
    And the escalation carries suggested_actions with an owner for each action
    And the escalation carries evidence_paths under swarmforge runtime

  # BL-1171 unrecoverable-diagnose-only-02
  Scenario: an unrecoverable parse error emits diagnose-only escalation without repair storm
    Given handoffd fails startup with a parse error in the log
    When the babysitter sweep completes
    Then the escalation names the log path and human hotfix required
    And no bounded auto-repair storm is queued

  # BL-1171 operator-queue-json-detail-03
  Scenario: the operator queue receives parseable JSON detail for the disaster class
    Given a disaster-class escalation was emitted
    When the operator queue records the event
    Then the event detail includes failure_class and suggested_actions
    And the operator prompt can render the playbook without re-guessing symptoms
