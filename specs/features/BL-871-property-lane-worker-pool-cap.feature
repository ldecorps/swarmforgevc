Feature: The property lane bounds its worker pool the same way the unit lane does

  # BL-871 property-lane-worker-pool-cap-01
  Scenario Outline: every Vitest lane declares a bounded worker pool
    Given the Vitest configuration "<config>"
    Then it declares a forked pool with a worker ceiling
    And it declares a per-worker heap limit

    Examples:
      | config                       |
      | vitest.config.mjs            |
      | vitest.properties.config.mjs |

  # BL-871 property-lane-worker-pool-cap-02
  Scenario: both lanes size their pool from the same shared budget module
    Given the Vitest configuration "vitest.properties.config.mjs"
    Then its worker ceiling and heap limit come from the shared worker budget module
    And it contains no literal worker count or heap size

  # BL-871 property-lane-worker-pool-cap-03
  Scenario Outline: the pool shrinks to what the host can hold
    Given a host with <ram> MB of RAM
    When the property lane resolves its worker pool size
    Then the resolved pool size is <workers>

    Examples:
      | ram   | workers |
      | 16384 | 6       |
      | 8192  | 3       |
      | 2048  | 1       |

  # BL-871 property-lane-worker-pool-cap-04
  Scenario: a subprocess-heavy property file passes under a full-suite run
    Given the whole property suite is run on this host
    Then every property file reaches a verdict without timing out
