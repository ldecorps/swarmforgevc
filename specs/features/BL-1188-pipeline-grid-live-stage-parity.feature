Feature: Pipeline STATUS GRID matches live stage report for claimed work

  The PWA Pipeline STATUS GRID at /pipeline-grid must be at least as accurate as
  the Telegram live board and Resident Spy about who is doing what. It must read
  the same live pipeline_stage_cli.bb report path BL-487 wired for Telegram —
  not the coordinator-written ticket-stage-map cache alone — and must not mark
  deep coder new/ queue volume as "everyone is at coordinator."

  Background:
    Given the pipeline STATUS GRID live capture runs for the target swarm

  # BL-1188 live-report-not-cache-01
  Scenario: Grid capture derives role-held tickets from the live stage report
    Given the live stage report names ticket "BL-428" at role "hardender"
    And the ticket-stage-map cache names ticket "BL-428" at role "coordinator"
    When the pipeline STATUS GRID snapshot is captured
    Then the grid row for "BL-428" shows stage "hardender"
    And the capture did not use the cache as its sole source of truth

  # BL-1188 claimed-not-co-flood-02
  Scenario: Active tickets are not all marked coordinator when only the coder queue is deep
    Given ticket "BL-1175" is claimed in_process at "hardender"
    And ticket "BL-605" is claimed in_process at "qa"
    And the coder role has "29" parcels in new but none in_process for those tickets
    When the pipeline STATUS GRID snapshot is captured
    Then the grid row for "BL-1175" shows stage "hardender"
    And the grid row for "BL-605" shows stage "qa"
    And fewer than half of active rows show stage "coordinator"

  # BL-1188 spy-parity-03
  Scenario: Grid stage marks agree with Resident Spy held tickets for the same tick
    Given the live stage report and Live Screen held-ticket resolution agree ticket "BL-726" is at "coder"
    When the pipeline STATUS GRID snapshot is captured
    And the Live Screen capture builds role tile payloads for the same tick
    Then the grid row for "BL-726" shows stage "coder"
    And the "coder" Live Screen tile shows "BL-726" as its primary working ticket

  # BL-1188 queued-not-claimed-04
  Scenario: A parcel queued in new at a role is not rendered as claimed working at that role
    Given ticket "BL-647" has a parcel in "cleaner" new with no in_process claim anywhere
    And the live stage report marks "BL-647" as in-transit to "cleaner"
    When the pipeline STATUS GRID snapshot is captured
    Then the grid row for "BL-647" does not show status claimed at "cleaner"

  # BL-1188 freshness-each-tick-05
  Scenario: Each grid capture recomputes from live state rather than reusing a stale snapshot
    Given the live stage report moves ticket "BL-428" from "architect" to "hardender" between ticks
    When two consecutive pipeline STATUS GRID snapshots are captured
    Then the later snapshot row for "BL-428" shows stage "hardender"
