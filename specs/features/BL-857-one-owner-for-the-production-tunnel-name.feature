Feature: exactly one process owns the production tunnel name, and orphans are reaped

  Measured on the live host 2026-08-08: thirteen `cloudflared ... run
  swarmforge-bubble` processes, twelve of them orphans from
  `bl787-nodefault-prop-*` property-test sandboxes, all fighting over one named
  tunnel. Host load peaked around 350-400 and Bubble turns timed out at the
  Android client's 120s read timeout while the bridge itself was fine. Ops
  cleared the twelve by hand; load fell into the 30s.

  The cause is narrower than "kill-all misses them". The reap is scoped to a
  single pidfile, and that pidfile is root-relative:
  launch_resident_spy_tunnel.sh writes "$ROOT/.swarmforge/operator/
  resident-spy-cloudflared.pid" and stop_ancillary_services.sh reads the same
  path under the LIVE root. A sandbox runs with its own $ROOT, so its pidfile
  lands inside its own temp tree, where the live stop path can never look — and
  when the temp tree is deleted the only record of the pid is destroyed while
  the process keeps running, still bound to the production tunnel name.

  So ownership has to outlive the tree that created it, and the production
  tunnel name has to have exactly one owner.

  Background:
    Given the operator instance owns the production tunnel name

  # BL-857 orphan-reaped-01
  Scenario: the stop path reaps a tunnel whose launching tree is gone
    Given a tunnel bound to the production tunnel name whose launching tree has been deleted
    When the stop path runs
    Then that tunnel is no longer running

  # BL-857 operator-instance-survives-02
  Scenario: the operator instance is never mistaken for an orphan
    Given a tunnel bound to the production tunnel name whose launching tree has been deleted
    When the stop path runs
    Then the operator instance is still running

  # BL-857 sandbox-cannot-bind-production-name-03
  Scenario: a run outside the operator root cannot bind the production tunnel name
    When a sandbox launches a tunnel under its own root
    Then it does not bind the production tunnel name

  # BL-857 test-teardown-leaves-nothing-04
  Scenario: a test run leaves no tunnel behind
    Given a test run has launched a tunnel of its own
    When that test run tears down
    Then no tunnel from that run is still running

  # BL-857 stale-ownership-record-05
  Scenario: an ownership record whose process has exited claims nothing
    Given an ownership record whose process has already exited
    When the stop path runs
    Then the record is not treated as a live owner
    And the operator instance is still running

  # BL-857 reap-is-name-scoped-06
  Scenario: a tunnel serving a different name is left alone
    Given a tunnel bound to some other tunnel name
    When the stop path runs
    Then that tunnel is still running
