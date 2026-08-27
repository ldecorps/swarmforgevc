Feature: deprecator freshness gate refuses stale paused tickets at promotion

  # BL-1173 (epic BL-1172): machine-checkable Article 3.6 gate. CLI prints
  # allow|hold JSON; promotion path fails closed on hold. Manual checklist
  # remains until CLI ships; this slice replaces it.

  Background:
    Given the Article 3.6 deprecator freshness gate is in force

  # BL-1173 freshness-hold-superseded-marker-01
  Scenario: check holds when a supersede marker exists for the ticket
    Given a paused ticket BL-x with a supersede marker on disk
    When the deprecator freshness check runs for BL-x
    Then the decision is hold
    And the reason names the supersede marker

  # BL-1173 freshness-hold-retired-surface-02
  Scenario: check holds when depends_on are done but the ticket names retired behaviour
    Given a paused ticket whose depends_on are all done
    And its description names a module or verb living docs mark RETIRED
    When the deprecator freshness check runs for that ticket
    Then the decision is hold
    And the reason names the stale premise

  # BL-1173 freshness-allow-clean-03
  Scenario: check allows a ticket with no stale signals
    Given a paused ticket with no supersede marker and no retired-surface references
    When the deprecator freshness check runs for that ticket
    Then the decision is allow

  # BL-1173 promote-path-fail-closed-04
  Scenario: promotion refuses when the freshness check holds
    Given the freshness check returns hold for a candidate
    When promotion into active is attempted
    Then the ticket stays in paused
    And a note to the specifier names the hold reason

  # BL-1173 cli-failure-fail-closed-05
  Scenario: CLI failure fails closed like the onboarding contract gate
    Given the deprecate-check CLI cannot run or returns malformed output
    When promotion consults the freshness gate
    Then promotion is refused
    And the failure is surfaced rather than treated as allow
