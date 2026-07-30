Feature: a scheduled producer walks role transcripts and fills the context-telemetry store

  # BL-665: GH-22 shipped the context-telemetry store, CLI, and GH-23's
  # dashboard, but no producer ever calls `record` — the store
  # (.swarmforge/telemetry/context-events.jsonl) has been empty since
  # 2026-07-22 and the dashboard has honestly displayed "No telemetry
  # recorded yet" for four days (epic runtime-wiring-slice rule, the
  # BL-298/BL-419 shape). Fix wires a deterministic transcript-walker pass
  # (built on the BL-664 lib, not a new parser) that runs unattended and
  # calls the existing record path — backfill on first run, idempotent on
  # every run after.

  # BL-665 producer-fills-the-store-01
  Scenario: one producer run on a host with existing transcripts fills the telemetry store
    Given role transcripts exist for at least one real role on this host
    And the context-telemetry store has never been populated
    When the transcript-walker producer runs once
    Then "context_telemetry_cli.bb summary" returns non-empty output
    And "context_telemetry_cli.bb agents" names a real role

  # BL-665 rerun-over-same-window-is-idempotent-02
  Scenario: running the producer twice over the same transcript window does not duplicate records
    Given the transcript-walker producer has already ingested a given window of transcripts
    When the producer runs again over that same window
    Then the context-telemetry record count is unchanged

  # BL-665 backfill-covers-history-before-first-run-03
  Scenario: the first producer run backfills events from transcripts predating it
    Given role transcripts exist from before the producer's first run
    And the context-telemetry store is empty
    When the transcript-walker producer runs for the first time
    Then it derives context-usage events for those pre-existing transcripts, not only new ones going forward

  # BL-665 dashboard-reflects-a-filled-store-04
  Scenario: the dashboard stops reporting an empty store once the producer has run
    Given the context-telemetry store was empty and the dashboard showed "No telemetry recorded yet"
    When the transcript-walker producer runs and fills the store
    Then the dashboard no longer shows "No telemetry recorded yet"
