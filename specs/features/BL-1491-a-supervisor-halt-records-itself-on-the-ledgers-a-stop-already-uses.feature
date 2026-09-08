Feature: BL-1491 a supervisor halt records itself on the ledgers a stop already uses

  halt-swarm! kills every role session and the tmux server, and nothing on
  that path writes the kill-all-audit row or the availability stop record a
  deliberate kill_pipeline_swarm.sh stop leaves. On 2026-09-08 the swarm died
  at 01:47, 02:30, 03:21 and 03:44Z; the audit log's last row is from the
  previous morning and the availability ledger holds only the midnight
  restart. The halt writes both records, before the first session dies, and a
  record that cannot be written never stops the halt.

  Background:
    Given a fixture project root with no tmux socket file
    And a supervisor whose alarm email and swarm halt are recorded, not performed

  # BL-1491 halt-records-itself-01
  Scenario: a stalled verdict's halt leaves one kill-all-audit row naming the supervisor and the verdict
    When the supervisor runs alarm-and-halt for the "stalled" verdict
    Then the daemon directory's kill-all-audit log gains exactly one row
    And that row names "handoffd_supervisor" and "stalled"

  # BL-1491 halt-records-itself-02
  Scenario: the availability ledger gains a proven stop record the reader pairs with the next start
    When the supervisor runs alarm-and-halt for the "stalled" verdict
    And a swarm start record follows it in the ledger
    Then the current month's availability ledger gains exactly one "stop" record of class "swarm-stop" whose source names "handoffd_supervisor"
    And the ledger reader folds them into one "swarm-stop" interval with provenance "proven"

  # BL-1491 halt-records-itself-03
  Scenario: both records are written before the first session is killed
    When the supervisor runs alarm-and-halt for the "dead" verdict
    Then both records already exist at the moment the swarm halt is invoked

  # BL-1491 halt-records-itself-04
  Scenario: a ledger that cannot be written never prevents the halt
    Given the telemetry directory is not writable
    When the supervisor runs alarm-and-halt for the "stalled" verdict
    Then the swarm halt is invoked once
    And the failure log is still written
