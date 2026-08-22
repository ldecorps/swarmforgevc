Feature: BL-1061 a tunnel-ownership fixture never binds a name the host is already serving
  The ownership property test drives the real reap edge, and that edge
  enumerates the HOST process table with `pgrep -fl -- "run <name>"`. Two
  coupled defects meet there. The enumeration has never worked on a GNU
  userland: `-l` prints the full argument list on BSD and the process NAME
  alone on procps-ng, so `tunnel_decide_orphans` is handed `<pid> bash`,
  matches no `run <name>` token pair, and selects nothing. Separately, a
  fixture in a sibling property suite binds the literal production name
  `swarmforge-bubble` - a binding the inert enumeration kept harmless.
  Repairing the enumeration is precisely what would ARM a reap scoped to that
  name to reach the operator's real tunnel, so the two cannot land apart.
  The hazard runs in both directions: the suite cannot pass while the operator's
  tunnel is up, and the operator's tunnel can be killed by the suite.

  Background:
    Given a live process this run did not start, serving tunnel name "swarmforge-bubble"

  # BL-1061 tunnel-fixture-isolation-01
  Scenario: the fixture chooses a name no other process is serving
    When the ownership fixture chooses its tunnel name
    Then the chosen name is unique to this run
    And no process outside this run is serving the chosen name

  # BL-1061 tunnel-fixture-isolation-02
  Scenario Outline: a reap signals only processes this run created
    When the run reaps orphans for the <target> tunnel name
    Then every signalled pid was created by this run
    And the pre-existing process is still alive

    Examples:
      | target       |
      | own fixture  |
      | pre-existing |

  # BL-1061 tunnel-fixture-isolation-03
  Scenario: a fixture leaked by an earlier run is swept before the table is read
    Given a fixture process leaked by an earlier run is still alive
    When the ownership suite reaches its first assertion about the process table
    Then the leaked fixture is no longer alive

  # BL-1061 tunnel-fixture-isolation-04
  Scenario: the isolation guard is non-vacuous
    Given the fixture is forced to bind "swarmforge-bubble"
    When the ownership suite runs
    Then the suite fails and its message names "swarmforge-bubble"
