Feature: BL-1534 The bl1373 property bounds its sweeps and counts decisive draws

  extension/test/bl1373PathSetCacheInvariants.property.test.js spawns the
  real babysitter_check.bb once or twice per fast-check draw, forty draws
  in all, against a 20 s per-test timeout, so it passes on an idle host and
  times out on a busy one. It also returns green when neither sweep found
  the commit, so a sweep that never reports anything passes. This feature
  is that each test runs a bounded, stated number of sweeps, that every
  draw which sweeps is decisive by construction, and that a run with no
  decisive draw fails.

  Background:
    When extension/test/bl1373PathSetCacheInvariants.property.test.js runs alone under the properties config

  # BL-1534 bounds-sweeps-counts-decisive-01
  Scenario: the property file is green on the tree as it stands
    Then every test in it passes

  # BL-1534 bounds-sweeps-counts-decisive-02
  Scenario Outline: each test states and keeps a sweep budget that fits its timeout on a busy host
    Then the run prints a reach map for the <test> test
    And that reach map stays within a budget of 10 sweeps

    Examples:
      | test               |
      | invariant 1        |
      | invariant 2        |
      | cache invalidation |

  # BL-1534 bounds-sweeps-counts-decisive-03
  Scenario Outline: every draw that sweeps is decisive and the run says how many there were
    Then the run prints a reach map for the <test> test
    And that reach map counts at least 4 decisive draws
    And that reach map counts no draw that swept without being decisive

    Examples:
      | test               |
      | invariant 1        |
      | invariant 2        |
      | cache invalidation |
