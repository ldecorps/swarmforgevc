Feature: BL-1336 a rotation-router pack raises the vitest fork ceiling

  `resolveVitestForkCeiling` is BL-935's CPU-axis ceiling and today reads only
  the pack name and the platform: `full-forge` on darwin gets 1, everything
  else falls through to MAX_WORKERS, which is 6. Mono-router packs are
  therefore not throttled by it - they simply never benefited from being
  recognised either.

  Under `config rotation router` the topology is structurally different:
  `swarmforge.sh` launches only the coordinator and ONE resident pane that
  rotates in place through every pipeline role, with every other role reduced
  to dormant launch artifacts - no session, no process. A vitest run inside
  the resident contends with the coordinator, not with seven sibling role
  sessions, so the one CPU-contention signal the ceiling exists to guard
  against does not apply.

  Rotation mode is not visible to the test runner today. `SWARMFORGE_PACK` is
  exported into the role env at launch, but the rotation value is only written
  into `.swarmforge/swarm-identity` and never exported, so there is currently
  no signal the ceiling logic could read. Keying on rotation rather than on
  pack NAMES matters because router packs are not a fixed enum - new ones are
  minted regularly.

  The RAM-derived pool size stays the real safety backstop throughout: raising
  a CPU ceiling can never widen the pool past what the host's memory allows.

  # BL-1336 ceiling-by-topology-01
  Scenario Outline: the fork ceiling follows the swarm topology
    Given a swarm running the <pack> pack in <rotation> mode on <platform>
    When the vitest fork ceiling is resolved
    Then the ceiling is <ceiling>

    Examples:
      | pack        | rotation   | platform | ceiling         |
      | full-forge  | sequential | darwin   | one             |
      | full-forge  | sequential | linux    | the default     |
      | mono-router | router     | linux    | the raised one  |
      | mono-router | sequential | linux    | the default     |

  # BL-1336 ram-budget-still-binds-02
  # The raised ceiling is a ceiling, never a floor. BL-422/BL-792's memory
  # budget remains the binding cap on a small host.
  Scenario: the memory budget still caps the pool on a small host
    Given a swarm running a router pack on a host whose memory allows fewer workers than the raised ceiling
    When the vitest worker pool is sized
    Then the pool size is what the memory budget allows

  # BL-1336 both-lanes-share-one-route-03
  # BL-935 invariant 3 and BL-871: the unit and property lanes must not be
  # able to drift apart by one of them gaining a route the other lacks.
  Scenario: the unit and property lanes size their pools identically
    Given a swarm running a router pack
    When each vitest lane sizes its worker pool
    Then both lanes resolve the same pool size
