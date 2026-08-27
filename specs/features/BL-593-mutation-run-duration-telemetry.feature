Feature: mutation runs append durable duration telemetry

  # BL-593: Stryker mutation.json has no wall-clock; mutation-progress/<role>.json
  # overwrites a single snapshot (often frozen mid-run). On completion, append one
  # interpretable record to .swarmforge/telemetry/mutation-runs.jsonl — scope,
  # mutant count, incremental flag, concurrency, kill stats, build_sha — mirroring
  # context-events.jsonl posture (gitignored, append-only, machine-local).

  Background:
    Given a fixture project root with an empty mutation-runs telemetry log

  # BL-593 completion-append-01
  Scenario: a completed mutation run appends exactly one durable record without changing the live snapshot
    Given a mutation run completes through the normal Stryker completion hook
    When the mutation progress reporter finalizes the run
    Then exactly one line is appended to mutation-runs.jsonl
    And the live per-role mutation-progress snapshot behavior is unchanged

  # BL-593 record-fields-02
  Scenario: the appended record carries scope timing concurrency and kill stats needed to interpret duration
    Given a completed scoped mutation run with known scope glob mutant total and incremental cache state
    When the completion record is built
    Then the record includes started_at ended_at and elapsed_s
    And the record includes role scope with mutant total incremental flag and effective concurrency
    And the record includes the kill-status breakdown and build_sha at run time

  # BL-593 aborted-no-false-complete-03
  Scenario: a killed or aborted run never appends a misleading completed full-run record
    Given a mutation run is killed before the normal completion report fires
    When the run ends abnormally
    Then mutation-runs.jsonl gains no record that reads as a completed full run
    And either no line is appended or the line carries aborted true with partial kill stats

  # BL-593 pure-record-builder-04
  Scenario: the completion record is built by a pure function unit-tested without fs or Stryker
    Given fixture mutation progress state start and end timestamps and scope metadata
    When the mutation run record builder is invoked
    Then the output matches the expected JSON object for those inputs
    And the builder performs no filesystem or Stryker access

  # BL-593 append-only-gitignored-05
  Scenario: the telemetry log is append-only machine-local runtime data never committed
    Given mutation-runs.jsonl already has prior completion lines
    When another mutation run completes
    Then a new line is appended without rewriting prior lines
    And mutation-runs.jsonl is gitignored under .swarmforge/telemetry like context-events.jsonl
