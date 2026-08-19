Feature: a vitest run under a live full-forge pack on macOS takes one fork, not the whole memory budget

  # BL-935 (swarm-reliability). extension/vitest.config.mjs already caps its
  # forked-process pool via resolveWorkerPoolSize (BL-422/BL-792), but that
  # budget is derived from os.totalmem() alone - a MEMORY axis, sized to stop
  # an OOM death-spiral. Nothing governs the CPU axis. On the swarm host
  # (2 physical cores) a full-forge pack already runs 8 concurrent agent
  # sessions plus handoffd and the bridge before any test tooling starts;
  # two concurrent `vitest run` invocations then add 3 forks each on top.
  #
  # This adds a SECOND, independent ceiling on the same resolved number. It
  # does not change, weaken, or replace the memory budget: that budget stays
  # an absolute upper bound the new rule can only shrink, never raise.
  #
  # The pack is readable with no new wiring - SWARMFORGE_PACK is already
  # exported into every agent's environment (verified live 2026-08-19:
  # SWARMFORGE_PACK=full-forge in a role shell). A human running the suite
  # solo has no such variable and is unaffected.
  #
  # Step handlers: specs/pipeline/steps/bl935VitestForkPoolSteps.js, driving
  # the pure resolver in-process with stubbed env and platform. The <pack>,
  # <platform> and <override> columns are validated against explicit
  # KNOWN_VALUES, never passed through. The resolver is pure and needs no
  # fixture directory - do not introduce one.

  Background:
    Given a host whose memory-derived worker budget is 3 forks

  # BL-935 vitest-fork-pool-01
  Scenario Outline: the fork count is decided by the pack, the platform, and an explicit override
    Given the pack is <pack>
    And the platform is <platform>
    And the explicit fork override is <override>
    When the worker pool size is resolved
    Then the run is given <forks> forks

    Examples:
      | pack        | platform | override    | forks |
      | full-forge  | macOS    | unset       | 1     |
      | full-forge  | Linux    | unset       | 3     |
      | mono-router | macOS    | unset       | 3     |
      | unset       | macOS    | unset       | 3     |
      | full-forge  | macOS    | 2           | 2     |
      | full-forge  | macOS    | 9           | 3     |
      | full-forge  | macOS    | not-a-number| 1     |
      | unset       | Linux    | 9           | 3     |

  # BL-935 vitest-fork-pool-02
  Scenario: the unit lane and the property lane size their pools identically
    Given the pack is full-forge
    And the platform is macOS
    When the unit config and the property config each resolve their worker pool
    Then both report the same fork count
