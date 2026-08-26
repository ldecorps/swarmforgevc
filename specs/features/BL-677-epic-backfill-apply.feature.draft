Feature: Epic backfill apply

  Background:
    Given a fixture done tree with untagged tickets and an epic roster "console,reliability"
    And a mapping file derived from the proposal report

  # BL-677 epic-backfill-apply-01
  Scenario: An approved mapping row writes the epic and commits through commit integrity
    Given the mapping is approved and maps "BL-010" to "console"
    When the apply runs
    Then "BL-010" carries epic "console" and the write landed via a commit-integrity commit

  # BL-677 epic-backfill-apply-02
  Scenario: A mapping without the human approval line refuses before any write
    Given the mapping has no approval line
    When the apply runs
    Then the run is refused and every backlog file is byte-identical to before

  # BL-677 epic-backfill-apply-03
  Scenario: An unknown epic value anywhere refuses the entire run before any write
    Given the mapping is approved and one row maps "BL-011" to "not-a-real-epic"
    When the apply runs
    Then the run is refused and every backlog file is byte-identical to before
    And the refusal names "not-a-real-epic"

  # BL-677 epic-backfill-apply-04
  Scenario: A ticket that already carries an epic is skipped and reported, never overwritten
    Given the mapping is approved and maps "BL-020" to "console" but "BL-020" already carries epic "reliability"
    When the apply runs
    Then "BL-020" still carries epic "reliability" and the summary reports it skipped

  # BL-677 epic-backfill-apply-05
  Scenario: Empty proposal cells are skipped and reported, not errors
    Given the mapping is approved and the "BL-012" row has an empty proposal cell
    When the apply runs
    Then "BL-012" is unchanged and the summary reports it skipped for judgment

  # BL-677 epic-backfill-apply-06
  Scenario: Writes land in batches, never one commit per ticket
    Given the mapping is approved with more rows than one batch holds
    When the apply runs
    Then the commit count equals the batch count and every commit went via commit integrity

  # BL-677 epic-backfill-apply-07
  Scenario: Re-running after success is a commitless no-op
    Given the apply already ran to completion with this mapping
    When the apply runs
    Then no file changes and no commit is created

  # BL-677 epic-backfill-apply-08
  Scenario: A mapping row naming a missing done file refuses the run as stale
    Given the mapping is approved and one row names "BL-999" which has no file under done
    When the apply runs
    Then the run is refused and every backlog file is byte-identical to before
    And the refusal names "BL-999"
