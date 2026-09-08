# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-07T15:50:14.791451508Z","feature_name":"BL-1348 The vitest fork pool sizes to the host the swarm actually runs on","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1348-fork-pool-sizes-to-the-real-host.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[]}
# acceptance-mutation-manifest-end

Feature: BL-1348 The vitest fork pool sizes to the host the swarm actually runs on

  Both vitest lanes size their worker pool through one shared composition,
  resolveVitestWorkerPool. It reserves a fixed per-worker heap against half
  the host's RAM. On a 20-core, 19904 MB host that reservation resolves to
  seven, so an operator who explicitly asks for more forks is silently given
  seven, and fourteen cores stay idle for the whole run. This feature is that
  an explicit override is honoured on a host with room for it, while a host
  given no override is still bounded by what its RAM allows. With no
  override the default ceiling is the cores the host has free, cores minus
  the 5-minute load average, floor 1, cap cores.

  # BL-1348 pool-follows-host-and-override-01
  Scenario Outline: the resolved pool follows the host and the operator's explicit override
    Given a <pack> pack on <platform> with <ram> MB of RAM
    And the operator fork override is <override>
    When a vitest lane resolves its worker pool
    Then the resolved pool is <pool>

    Examples:
      | pack        | platform | ram   | override | pool |
      | mono-router | linux    | 19904 | 12       | 12   |
      | full-forge  | darwin   | 4096  | unset    | 1    |

  # BL-1348 no-override-still-bounded-02
  Scenario: with no override the pool still fits the host memory budget
    Given a mono-router pack on linux with 4096 MB of RAM
    And the operator fork override is unset
    When a vitest lane resolves its worker pool
    Then the resolved pool is at least 1
    And the worst case footprint of the resolved pool is within the host safe RAM fraction

  # BL-1348 no-override-follows-free-cores-03
  Scenario Outline: with no override the default ceiling is the cores the host has free
    Given a full-forge pack on linux with <cores> cores, 19904 MB of RAM and a 5-minute load average of <load>
    And the operator fork override is unset
    When a vitest lane resolves its worker pool
    Then the resolved pool is <pool>

    Examples:
      | cores | load | pool |
      | 20    | 12   | 8    |
      | 20    | 17   | 3    |
      | 20    | 19.5 | 1    |
