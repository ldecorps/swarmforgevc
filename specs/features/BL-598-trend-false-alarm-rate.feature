# mutation-stamp: sha256=7b0ffe5f66a3f17f75c1d680b31a1babe444420d263a5fc079a3a541f22348aa
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T21:11:55.950745281Z","feature_name":"false-alarm rate trend makes observability noise measurable","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-598-trend-false-alarm-rate.feature","background_hash":"70625d1fcf253253db86560ffbce4d9b39e55e9dda5664c53ea92d45068f7041","implementation_hash":"unknown","scenarios":[{"index":0,"name":"each emitted alert logs a verdict the sweep already computed","scenario_hash":"17c400aa252c3ce3db5bc70e542fcafa23a35fd962dac1f222a0f4bc43d010f6","mutation_count":12,"result":{"Total":12,"Killed":12,"Survived":0,"Errors":0},"tested_at":"2026-08-25T21:11:55.950745281Z"}]}
# acceptance-mutation-manifest-end
Feature: false-alarm rate trend makes observability noise measurable
  BL-598 (epic BL-594). AGENT_EXITED false positives, active-backlog-depth
  warnings under a cap-of-1 steady state, and other self-cancelling alerts
  fire repeatedly while the operator already classifies them NO-OP vs acted.
  This ticket MEASURES only — it does not suppress alerts (BL-562 and kin fix
  specific ones). Each alert emits {alert-type, fired, verdict, ts} to
  `.swarmforge/telemetry/alerts-<YYYY-MM>.jsonl`; a pure aggregator yields
  per-type false-positive rate via trend.ts. Verdict comes from the existing
  NO-OP-vs-acted reasoning at emit time, not a new judge.

  Background:
    Given alert telemetry emits to the alerts log

  # BL-598 each-alert-logs-verdict-from-existing-classification-01
  Scenario Outline: each emitted alert logs a verdict the sweep already computed
    When <alert> fires and the operator sweep classifies it as <verdict>
    Then exactly one record is appended to the alerts log
    And the record carries alert-type <alert-type>
    And the record carries verdict <verdict>
    And the record carries when it fired

    Examples:
      | alert                                      | alert-type              | verdict          |
      | an AGENT_EXITED mono-router false positive | AGENT_EXITED            | false-positive   |
      | an active-backlog-depth steady-state warn  | active-backlog-depth    | false-positive   |
      | a self-cancelling NO-OP within one sweep   | operator-no-op          | false-positive   |
      | an alert the operator acts on              | operator-actionable     | actionable       |

  # BL-598 aggregator-yields-per-type-false-positive-rate-02
  Scenario: a pure aggregator yields per-type false-positive rate over a window
    Given a log of alert records spanning more than one window
    And some records are false-positive and some are actionable
    When each alert-type series is aggregated
    Then each window reports that type's false-positive rate
    And the aggregation reads no files of its own

  # BL-598 raw-log-append-only-gitignored-03
  Scenario: the alerts log is append-only and excluded from version control
    Given the alerts log already holds earlier records
    When a further alert record is emitted
    Then the earlier records are still present unchanged
    And the log is excluded from version control

  # BL-598 measuring-never-changes-alert-emission-04
  Scenario: a telemetry write failure does not change alert emission
    Given the alerts log cannot be written
    When an alert that would normally fire is evaluated
    Then the alert still fires or suppresses exactly as before
    And the operator sweep is not left waiting on the log
