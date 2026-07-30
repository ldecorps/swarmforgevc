Feature: Hardening gates are not blocked by tracked vitest cache or raw mkdtemp call sites
  Two main defects currently fail Stryker dry-run / full coverage for every
  ticket: a tracked gitignored vitest cache blob that trips the facilitator
  residual scan, and four bridge tests that bypass the shared temp-dir helper.
  Source: hardener forensics 2026-07-30; BL-714 (expedite).

  # BL-714 harden-gate-01
  Scenario: the tracked vitest cache blob is gone from git
    Given the repository index is inspected for vite/vitest cache results under node_modules
    Then no vitest results.json under node_modules/.vite/vitest is tracked
    And the facilitator residual scan does not fail solely because of a cache blob

  # BL-714 harden-gate-02
  Scenario: the four bridge tests use the shared temp helper
    Given the raw-mkdtemp migration guard walks extension/test
    Then telegramCursorBridgeExpedite.test.js has no raw mkdtemp call site
    And telegramCursorBridgeLogs.test.js has no raw mkdtemp call site
    And telegramCursorBridgeRedeploy.test.js has no raw mkdtemp call site
    And telegramCursorBridgeUpdate.test.js has no raw mkdtemp call site

  # BL-714 harden-gate-03
  Scenario: the migration guard itself is green
    When the tmpDirMigrationGuard suite runs
    Then it reports zero unexpected raw mkdtemp call sites
