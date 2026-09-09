# mutation-stamp: sha256=80381189fb8e9899b8679a83ae5d1111618015d320e55ec08526aa81627ee807
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-09T01:37:36.076027825Z","feature_name":"BL-1410 Acceptance step handlers take their fixture roots from the steps-lane helper","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1410-step-handlers-take-their-fixture-root-from-the-steps-lane-helper.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a migrated feature's acceptance run removes every fixture root it created","scenario_hash":"90fae3777179f1c5c6fb95eeb38c44732419bc7bbf38c24d0f944e9ecaa1c25b","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-09T01:37:36.076027825Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1410 Acceptance step handlers take their fixture roots from the steps-lane helper

  Seventeen step handlers reference mkTmpDir, extension/test's fixture helper.
  Its cleanup is a Vitest afterEach that the acceptance runner - plain
  node --test through specs/pipeline/runtime.js - never loads, so every
  acceptance run of those features leaves its scratch root in the temp
  directory. Two of them instead define a local mkTmpDir that is a bare
  mkdtemp with no cleanup under any runner. BL-1226 will gate TOUCHED
  handlers onto the steps-lane helper, socketFixtureRoot, whose exit hook
  removes every root it handed out; it deliberately migrates nothing. This
  is the migration for this one sub-class.

  A root is removed because the helper that created it tracks it, never
  because something listed the temp directory by prefix: a prefix sweep
  deletes a concurrent run's fixtures (BL-1385, BL-1390). And a handler that
  carries the helper's name inside a string literal, as fixture data for a
  convention-gate feature, is data and stays byte-for-byte.

  # BL-1410 a-migrated-feature-removes-every-root-it-created-01
  Scenario Outline: a migrated feature's acceptance run removes every fixture root it created
    When the feature for "<ticket>" runs under the acceptance runner with fixture-root creation traced
    Then every scenario run passes
    And at least one fixture root was created during the run
    And no fixture root the run created still exists after the run

    Examples:
      | ticket |
      | BL-551 |
      | BL-565 |
      | BL-664 |
      | BL-771 |

  # BL-1410 no-handler-takes-the-vitest-swept-route-02
  Scenario: no acceptance step handler obtains a fixture root through the Vitest-swept helper
    When every step handler under specs/pipeline/steps is read as code
    Then none imports mkTmpDir from extension/test's tmpDir helper
    And none defines a local mkTmpDir over a raw mkdtemp

  # BL-1410 fixture-data-is-not-rewritten-03
  Scenario: a handler that carries the helper's name as fixture data is left byte-for-byte
    Given the convention-gate handlers that write mkTmpDir into scratch files as test data
    When every step handler under specs/pipeline/steps is read as code
    Then those string literals are unchanged
    And their features still pass under the acceptance runner
