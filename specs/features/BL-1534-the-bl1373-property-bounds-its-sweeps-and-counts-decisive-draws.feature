# mutation-stamp: sha256=547def44b1a32cb6e4606fb2e79186cf1d58600718138b65d15f49ec3e8f90d5
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-11T12:39:16.436944902Z","feature_name":"BL-1534 The bl1373 property bounds its sweeps and counts decisive draws","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1534-the-bl1373-property-bounds-its-sweeps-and-counts-decisive-draws.feature","background_hash":"ba97987da0b1d4f8e82dc57971768b184deb8e37d91dffaf2d4a19e0fa732bf3","implementation_hash":"unknown","scenarios":[{"index":1,"name":"each test states and keeps a sweep budget that fits its timeout on a busy host","scenario_hash":"730732b3d06262ba54f607878a41e5fa9c10835c614e4111b48c95dc142f6e17","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-11T12:39:16.436944902Z"},{"index":2,"name":"every draw that sweeps is decisive and the run says how many there were","scenario_hash":"a4f7fe2e994b9c6087b7466e8305a7f926b0d3091ac11a29f5f26a268593ea0e","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-11T12:39:16.436944902Z"}]}
# acceptance-mutation-manifest-end

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
