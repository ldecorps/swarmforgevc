Feature: BL-839 follow-on — auto-repair durable master-checkout drift on daemon scripts
  BL-839 detects when daemon-executed scripts on the master checkout drift
  from main (MASTER CHECKOUT DRIFT). Auto-restore was deferred because it
  can discard uncommitted work. Human 2026-08-25: the swarm must deal with
  durable daemon-script drift without human intervention. Mute follow-ons
  BL-1122 / BL-1134 / BL-1137 only silence mid-commit false WARNs — they do
  not clear durable drift. This slice restores drifted daemon-executed
  paths from main when not commit-in-flight, emits a one-shot RESTORED note,
  and bounces handoffd so running load-file state matches disk. The check
  itself stays write-free; repair is a separate verb. Source: human Cursor
  2026-08-25; intake backlog/INTAKE-master-checkout-drift-auto-repair.md.

  Background:
    Given master-checkout drift detection for the daemon-executed path closure

  # BL-1139 durable-drift-restored-from-main-01
  Scenario: durable daemon-script drift is restored from main without a human
    Given a daemon-executed path differs from main and is classified as drift
    And commit-in-flight is false
    When the drift repair sweep runs
    Then that path matches main
    And Operator receives a one-shot MASTER CHECKOUT DRIFT RESTORED note naming the path
    And no repeating MASTER CHECKOUT DRIFT WARN remains for that restored episode

  # BL-1139 in-flight-never-restores-02
  Scenario: commit-in-flight never restores and keeps mute rules
    Given a daemon-executed path would classify as drift
    And commit-in-flight is true
    When the drift repair sweep runs
    Then no git checkout or restore runs against that path
    And existing in-flight mute rules are unchanged

  # BL-1139 restore-failure-still-warns-03
  Scenario: restore failure or residual drift still WARNs
    Given durable drift on a daemon-executed path
    And commit-in-flight is false
    When restore fails or re-check is still drift or unknown
    Then the existing MASTER CHECKOUT DRIFT WARN is still emitted

  # BL-1139 successful-restore-bounces-handoffd-04
  Scenario: successful restore bounces handoffd through the start chokepoint
    Given durable drift was restored from main successfully
    When the repair sweep finishes the restore
    Then handoffd and its supervisor are bounced via start_handoff_daemon.sh or restart-handoffd-group
    And the bounce is deferred so the current sweep tick can finish

  # BL-1139 repair-scoped-to-daemon-closure-05
  Scenario: repair candidates stay inside the daemon-executed closure
    Given drifted paths some of which are outside resolve-daemon-executed-paths
    When the repair sweep chooses restore candidates
    Then every restored path is in the daemon-executed closure
    And check-master-checkout-drift itself performs no writes
