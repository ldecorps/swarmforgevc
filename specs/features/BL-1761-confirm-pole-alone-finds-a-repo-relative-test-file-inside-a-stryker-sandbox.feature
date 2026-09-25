Feature: BL-1761 confirmPoleAlone finds a repo-relative test file inside a Stryker sandbox

  extension/scripts/recordTestDuration.js resolves a repo-root-relative
  file such as "extension/test/x.test.js" against REPO_ROOT_DIR, which is
  one directory above its extension root. Inside a Stryker sandbox the
  sandbox IS the extension root, and its parent is .stryker-tmp/, which
  has no extension/ child, so the confirmation finds nothing.
  confirmPoleAloneOutcomeShapes.test.js (BL-1721, landed 2026-09-24)
  measures a real file that way. It fails in every sandbox's initial test
  run, and Stryker refuses to mutate anything: "There were failed tests in
  the initial test run" (hardener, BL-1742, 2026-09-25). After this
  feature the same repo-relative path resolves to the same file in the
  real checkout and in a sandbox.

  # BL-1761 sandbox-shaped-root-finds-the-file-01
  Scenario: a repo-relative test path is confirmed from an extension root whose parent has no extension directory
    Given recordTestDuration.js copied into an extension root whose parent has no extension directory
    And that extension root holds a small passing test under test/
    When confirmPoleAlone confirms that test by its repo-relative path
    Then it returns a measured duration

  # BL-1761 real-checkout-unchanged-02
  Scenario: a repo-relative test path is still confirmed from the real checkout
    When confirmPoleAlone confirms "extension/test/bl1007ContentionBudgetSmoke.test.js" from the real checkout
    Then it returns a measured duration
