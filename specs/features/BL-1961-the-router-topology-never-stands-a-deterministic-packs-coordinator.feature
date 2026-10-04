Feature: BL-1961 The mono-router topology never counts a deterministic pack's coordinator as a standing session

  Split from BL-1932 (2026-10-04): the shared decision. On a pack declaring
  `config coordinator_mode deterministic` the coordinator is a roster row and
  a mailbox, never a seat (BL-1959). `mono_router_lib.bb`'s
  `should-have-standing-session?` still counts the resident and the
  coordinator as standing, so `topology-action` asks for the coordinator's
  session back. `swarm ensure` (BL-1962) and the babysitter (BL-1963) both
  ask this predicate on a router pack.

  Background:
    Given a fixture project whose pack declares "config coordinator_mode deterministic" and "config rotation router"
    And a stale coordinator launch script and no coordinator session

  # BL-1961 the-router-topology-stands-only-the-resident-01
  Scenario: the mono-router topology counts only the resident as a standing session
    When the standing sessions of the pack are listed
    Then the coordinator is not among them
