Feature: BL-1874 A failed throttle refresh never leaves an older recommendation in force

  Since hotfix 51591aab4a, the throttle CLI refreshes the rework signal
  before it recommends a cap. When that refresh throws, the CLI exits 1 and
  writes nothing, and effective_backlog_depth_cli.bb logs the failure and
  reads the recommendation file an earlier run left on disk. BL-1869's probe
  c reproduced it on 2026-10-01: a stale severe recommendation from an
  earlier run held the effective cap at 0. From this ticket on, a failed
  refresh publishes no rework recommendation and names the failure, so the
  cap falls back to the configured value and the standing-red half is
  computed as before.

  Background:
    Given a fixture project whose throttle recommendation from an earlier run reads severe with a cap of zero

  # BL-1874 a-failed-refresh-publishes-no-rework-recommendation-01
  Scenario: a refresh that cannot write its signal leaves the configured cap in force
    Given the rework signal cannot be written
    When the coordinator decides whether to promote the next item
    Then the effective active-depth cap is the configured value
    And the throttle recommendation names the failed refresh as its reason

  # BL-1874 a-successful-refresh-replaces-the-earlier-recommendation-02
  Scenario: a refresh that succeeds replaces the earlier recommendation
    Given the rework signal can be written
    When the coordinator decides whether to promote the next item
    Then the throttle recommendation was written by this run
