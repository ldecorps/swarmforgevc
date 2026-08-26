# mutation-stamp: sha256=948c65771b13edf6115e12b9716816e4b7dc2e4db338083d2a515a6c772fbf80
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T16:25:00.074447927Z","feature_name":"BL-1061 a tunnel-ownership fixture never binds a name the host is already serving","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1061-tunnel-ownership-fixture-binds-a-live-tunnel-name.feature","background_hash":"0eb87fd09152d02357c3b20fa3626e0bc27ba06ccdc7219647da03edb0efeeab","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a reap signals only processes this run created","scenario_hash":"48093a5219c8bcaf7041548f40b02ccd1f5145048b9e719cd4e46a0d8409c1a8","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-22T16:25:00.074447927Z"}]}
# acceptance-mutation-manifest-end

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
