Feature: the vitest worker pool and per-worker heap are capped so a test run cannot OOM the box

  # A plain `vitest run` / acceptance run sizes its worker pool to the CPU count
  # with no per-worker heap cap, so one run ballooned four `node (vitest N)`
  # workers to ~13GB on a 15GB host and drove the kernel OOM-killer into a
  # death-spiral that took the whole swarm down (Stryker's vitest-runner is
  # already single-threaded, so this gap is the DEFAULT pool, not mutation).
  # The worst-case footprint (max workers x per-worker heap) must stay within a
  # safe fraction of the smallest supported host RAM, and it is exposed as a
  # testable module value rather than living only inside the runner's config.

  Background:
    Given the project's vitest worker-memory budget is read from the shared configuration

  # BL-422 vitest-mem-budget-01
  Scenario: the worker pool has an explicit finite cap
    Given the vitest configuration
    When the maximum worker count is read
    Then it is an explicit finite cap rather than the CPU-count default

  # BL-422 vitest-mem-budget-02
  Scenario: each worker has an explicit heap cap
    Given the vitest configuration
    When a worker's heap limit is read
    Then an explicit per-worker max-old-space-size cap is set

  # BL-422 vitest-mem-budget-03
  Scenario Outline: the worst-case footprint stays within the host's safe budget
    Given <workers> capped workers each limited to <heap_mb> MB of heap
    And a host with <host_mb> MB of RAM
    When the worst-case test-run footprint is evaluated
    Then it is reported as <within_budget> the safe budget

    Examples:
      | workers | heap_mb | host_mb | within_budget |
      | 2       | 2048    | 15360   | within        |
      | 8       | 4096    | 15360   | over          |
