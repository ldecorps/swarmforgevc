Feature: BL-1962 swarm ensure never respawns a deterministic pack's coordinator seat

  Split from BL-1932 (2026-10-04): the ensure path. `swarm ensure` respawns a
  missing coordinator from whatever launch script it finds, and on this host
  a stale `.swarmforge/launch/coordinator.sh` exists, so ensure would recreate
  the seat within minutes of boot. BL-1961 makes the router topology leave
  the coordinator out; this slice makes ensure ask it with the pack's mode.

  Background:
    Given a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"
    And a stale coordinator launch script and no coordinator session

  # BL-1962 ensure-never-respawns-the-coordinator-01
  Scenario: swarm ensure creates no coordinator session and succeeds
    When swarm ensure runs
    Then no swarmforge-coordinator session exists
    And swarm ensure exits zero
    And no coordinator line of its report reads FAILED or FIXED

  # BL-1962 a-non-deterministic-pack-still-repairs-its-coordinator-02
  Scenario: a pack without the deterministic declaration still gets its missing coordinator back
    Given the fixture pack's "config coordinator_mode deterministic" line is removed
    When swarm ensure runs
    Then a swarmforge-coordinator session exists
