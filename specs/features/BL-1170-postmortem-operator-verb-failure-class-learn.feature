Feature: postmortem operator verb closes the disaster recovery learn loop

  # BL-1170 (epic BL-1168): /postmortem qualifies outage, updates babysitter
  # failure-class registry and operator playbook, mints INTAKE-disaster-* stub.
  # Soft confirm tier; reuses BL-698 verb backend and BL-958 incident record.

  Background:
    Given the shared operator verb backend from BL-698

  # BL-1170 postmortem-after-cleared-incident-01
  Scenario: postmortem after a cleared starvation cascade writes learn artefacts
    Given a recent cleared disaster incident with evidence in runtime logs
    When the operator runs postmortem
    Then a qualified record names failure_class and likely causes
    And the babysitter failure-class registry is updated
    And the operator playbook is updated
    And an INTAKE disaster stub is written under backlog

  # BL-1170 second-occurrence-uses-registry-02
  Scenario: a second occurrence of the same class uses the updated playbook
    Given the failure-class registry and playbook were updated by a prior postmortem
    When the same failure class fires again
    Then the next escalation names playbook suggested actions
    And babysitter emits one disaster-class finding instead of many symptom lines

  # BL-1170 refuse-without-incident-03
  Scenario: postmortem refuses when no recent incident exists
    Given no disaster incident within the lookback window
    When the operator runs postmortem
    Then the verb refuses with nothing to postmortem
    And no registry or intake stub is written

  # BL-1170 unrecoverable-class-playbook-04
  Scenario: postmortem for an unrecoverable class names human hotfix in the playbook
    Given a cleared incident whose root cause was an unrecoverable parse error
    When the operator runs postmortem
    Then the playbook says human hotfix is required
    And the babysitter registry still records the failure class for recognition
