Feature: Context telemetry capture — recorder and query CLI

  # GH-22 Slice 1. A pure, testable event log + aggregator over per-invocation
  # context/compaction telemetry. No live capture wiring here (that is a
  # separate Slice 2 follow-on, parked in
  # specs/features/GH-22-context-telemetry-slice-2.feature.draft) — these
  # scenarios exercise the recorder/query CLI against explicit fixture events.

  Background:
    Given the context-telemetry recorder CLI is available
    And the telemetry log is empty

  # GH-22 record-invocation-event-01
  Scenario: recording an invocation event appends it to the telemetry log
    When I record an invocation event for agent "coder" with 12000 input tokens, 400 output tokens, context utilisation 42%, and no compaction
    Then the telemetry log contains one event for "coder" with those values

  # GH-22 compaction-marks-time-to-first-02
  Scenario: recording a compaction event marks time-to-first-compaction
    Given agent "coder" has one prior recorded event at time "T0" with no compaction
    When I record a second event for "coder" at time "T1" that is marked as a compaction
    Then the summary for "coder" reports 1 compaction
    And reports a time-to-first-compaction equal to the elapsed time between "T0" and "T1"

  # GH-22 summary-aggregates-per-agent-03
  Scenario: querying a summary reports compaction count and average utilisation per agent
    Given agent "hardener" has 3 recorded events with context utilisation 30%, 60%, and 90%, and one marked as a compaction
    When I query the telemetry summary for "hardener"
    Then it reports 1 compaction
    And reports an average context utilisation of 60%

  # GH-22 malformed-record-rejected-04
  Scenario: recording an event with a malformed field is rejected and does not corrupt the log
    Given the telemetry log has 2 valid events for agent "coder"
    When I attempt to record an event for "coder" with a non-numeric input-token count
    Then the record command fails with a validation error
    And the telemetry log still contains exactly 2 events for "coder"

  # GH-22 missing-required-field-rejected-05
  Scenario: recording an event missing a required field is rejected and does not corrupt the log
    Given the telemetry log has 1 valid event for agent "architect"
    When I attempt to record an event for "architect" with no timestamp
    Then the record command fails with a validation error
    And the telemetry log still contains exactly 1 event for "architect"
