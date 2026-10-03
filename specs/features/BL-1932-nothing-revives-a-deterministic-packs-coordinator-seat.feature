Feature: BL-1932 Nothing revives a coordinator seat on a deterministic pack

  On a pack declaring `config coordinator_mode deterministic` the coordinator
  is a roster row and a mailbox, never a seat (BL-1931). The keep-alive paths
  still treat a missing coordinator pane as a fault to repair: `swarm ensure`
  respawns it from whatever launch script it finds, the mono-router topology
  counts it as a standing session, and babysitterd raises `pane-coordinator`,
  escalates to the operator and repairs it. On this host a stale
  `.swarmforge/launch/coordinator.sh` exists, so any of them would recreate
  the seat within minutes of boot.

  Background:
    Given a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"
    And a stale coordinator launch script and no coordinator session

  # BL-1932 ensure-never-respawns-the-coordinator-01
  Scenario: swarm ensure creates no coordinator session and succeeds
    When swarm ensure runs
    Then no swarmforge-coordinator session exists
    And swarm ensure exits zero
    And no coordinator line of its report reads FAILED or FIXED

  # BL-1932 babysitter-raises-no-coordinator-pane-finding-02
  Scenario: a babysitter sweep neither flags nor repairs the missing coordinator pane
    When a babysitter sweep runs
    Then the sweep raises no pane-coordinator finding
    And the sweep repairs nothing for the coordinator

  # BL-1932 the-router-topology-stands-only-the-resident-03
  Scenario: the mono-router topology counts only the resident as a standing session
    When the standing sessions of the pack are listed
    Then the coordinator is not among them

  # BL-1932 a-non-deterministic-pack-still-repairs-its-coordinator-04
  Scenario: a pack without the deterministic declaration still gets its missing coordinator back
    Given the fixture pack's "config coordinator_mode deterministic" line is removed
    When swarm ensure runs
    Then a swarmforge-coordinator session exists
