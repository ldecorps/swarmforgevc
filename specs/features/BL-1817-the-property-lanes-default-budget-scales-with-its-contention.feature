Feature: BL-1817 The property lane's default per-test budget scales with its own contention
  A property test that declares no timeout of its own runs under the
  lane's suite-wide default. That default was a fixed 20000 ms, and in a
  full-lane run on a loaded host, subprocess-heavy tests with a solo time
  of 6 to 18 seconds crossed it: eight files in five days. The default now
  comes from the same contention factor the per-test helper uses (the
  lane's forks and the host's 1-minute load, over a quiet ceiling of 4),
  from a 20000 ms base, never below the base and never above three times
  it. A lone file on a quiet host keeps exactly 20000 ms.

  # BL-1817 lane-default-follows-contention-01
  Scenario Outline: the lane default for <forks> forks at a 1-minute load of <load> is <budget> milliseconds
    When the property lane's default per-test budget is resolved for <forks> forks at a 1-minute load of <load>
    Then it is <budget> milliseconds

    Examples:
      | forks | load | budget |
      | 1     | 2    | 20000  |
      | 5     | 2    | 25000  |
      | 5     | 10   | 50000  |
      | 5     | 16   | 60000  |
      | 12    | 2    | 60000  |
