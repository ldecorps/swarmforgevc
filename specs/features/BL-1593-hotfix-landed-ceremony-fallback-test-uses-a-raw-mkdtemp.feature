Feature: BL-1593 The hotfix-landed ceremony fallback test allocates its fixture root through the shared tmpDir helper

  Hotfix a27d082c2d (2026-09-16) landed
  extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js on
  main outside the pipeline with a raw fs.mkdtempSync at line 29, one root
  per test body and never removed, so BL-1280's whole-tree mkdtemp guard is
  red on main and three directories leak into the temp dir per run. This
  feature is that the one allocation moves to the shared helper's per-test
  variant with the same lifetime, the guard's own detector finds no raw
  call site in the file or anywhere in the tree, and the fallback test still
  passes.

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
  Scenario: the fallback test still passes with the migrated fixture root
    When extension/test/nightClosingCeremonyRotateDocumenterFallback.test.js runs alone under the unit config
    Then every test in it passes
