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
