Feature: self-heal events trend makes automatic recovery visible

  # BL-597 (epic BL-594). The swarm heals constantly — stale-build recompiles,
  supervisor respawns, kill_all, rotation respawns, claim-heal — but counts
  none of it. Each action already emits a prose log line; this ticket structures
  that moment as {type, subject, reason, ts} in
  `.swarmforge/telemetry/self-heal-<YYYY-MM>.jsonl`. A pure aggregator yields
  per-type counts over a window via trend.ts. Measuring only — recovery behaviour
  is unchanged.

  Background:
    Given self-heal telemetry emits to the self-heal log

  # BL-597 each-self-heal-emits-structured-event-01
  Scenario Outline: each self-heal action emits one structured event at its existing log site
    When <action> occurs with subject <subject> and reason <reason>
    Then exactly one record is appended to the self-heal log
    And the record carries type <type>
    And the record carries subject <subject>
    And the record carries reason <reason>
    And the record carries when it occurred

    Examples:
      | action                              | type                  | subject                 | reason                    |
      | a stale-build-detected recompile    | stale-build-recompile | front-desk-supervisor   | recompiling before respawn |
      | a bounded supervisor respawn        | supervisor-respawn    | front-desk-supervisor   | bounded restart           |
      | a kill_all_swarm invocation         | kill-all-swarm        | lifecycle               | clean slate               |
      | a mono-router rotation respawn      | rotation-respawn      | mono-router-resident    | persona swap              |
      | a claim-heal or resume-orphan claim | claim-heal            | handoffd                | resume orphaned in_process |

  # BL-597 aggregator-yields-per-type-counts-02
  Scenario: a pure aggregator yields per-type counts over a window via trend.ts
    Given a log of self-heal records spanning more than one window
    And records of several self-heal types
    When each self-heal type series is aggregated
    Then each window reports that type's event count
    And the aggregation reads no files of its own

  # BL-597 raw-log-append-only-gitignored-03
  Scenario: the self-heal log is append-only and excluded from version control
    Given the self-heal log already holds earlier records
    When a further self-heal record is emitted
    Then the earlier records are still present unchanged
    And the log is excluded from version control

  # BL-597 measuring-never-changes-recovery-04
  Scenario: a telemetry write failure does not change self-heal behaviour
    Given the self-heal log cannot be written
    When a self-heal action that would normally run is triggered
    Then the recovery action still runs exactly as before
    And the caller is not left waiting on the log
