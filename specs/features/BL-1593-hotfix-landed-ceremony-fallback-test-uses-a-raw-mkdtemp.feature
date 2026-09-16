Feature: BL-1593 The hotfix-landed ceremony fallback test builds its fixture through the shared helpers

  Hotfix a27d082c2d (2026-09-16) landed
  extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js on
  main outside the pipeline. Its fixture builder allocates a root with a raw
  fs.mkdtempSync at line 29, one per test body and never removed, and
  symlinks every .bb under the live swarmforge/scripts by enumerating the
  checkout root, so BL-1280's property guard, BL-420's unit guard and
  BL-1038's live-repo derivation guard are all red on main and three
  directories leak into the temp dir per run. This feature is that the root
  moves to the shared helper's per-test variant with the same lifetime, the
  scripts dir is built from consult_spawn_cli.bb's derived dependency
  closure rather than an exemption, both real detectors find nothing in the
  file or anywhere in the tree, and the fallback test still passes.

  # BL-1593 ceremony-fallback-test-fixture-root-through-tmpdir-helper-01
  Scenario Outline: the raw mkdtemp guard finds no call site
    When the raw mkdtemp guard scans <target>
    Then it reports no raw call site

    Examples:
      | target                                                                 |
      | extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js    |
      | the whole extension test tree                                          |

  # BL-1593 ceremony-fallback-test-fixture-root-through-tmpdir-helper-02
  Scenario: the fallback test allocates its fixture root through the per-test helper, not by deleting the fixture
    When the source of extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js is read
    Then it allocates its fixture root through mkTmpDir exactly once

  # BL-1593 ceremony-fallback-test-fixture-root-through-tmpdir-helper-03
  Scenario: the live-repo derivation guard finds no violation and the fallback test records no exemption
    When the live-repo derivation guard scans the whole extension test tree
    Then it reports no violation
    And the fallback test carries no BL-1038 exemption marker

  # BL-1593 ceremony-fallback-test-fixture-root-through-tmpdir-helper-04
  Scenario: the fallback test still passes with the migrated fixture
    When extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js runs alone under the unit config
    Then every test in it passes
