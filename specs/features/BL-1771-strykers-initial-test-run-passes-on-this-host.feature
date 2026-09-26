Feature: BL-1771 Stryker's initial test run passes on this host

  Every hardener mutation run starts with Stryker's initial test run over
  the unit suite inside .stryker-tmp/, where the sandbox directory IS the
  extension root (BL-1066). BL-1761 fixed the file that failed that run
  first. Its hardener pass then found the two files still failing it:
  bl1418RoleEnumerationClassification.test.js, which reads extension
  sources through a root two parents up, and activePoolFreshnessAudit.test.js,
  ruled a Stryker-only red on 2026-09-02 and meant to be left out of the
  mutation run by a wiring nobody added. While either fails, no TypeScript
  parcel on this host can be mutation-tested.

  # BL-1771 the-default-mutation-run-leaves-out-only-the-ruled-file-01
  Scenario: the default Stryker run selects every unit test file except the one ruled a Stryker-only red
    Given the vitest configuration the default Stryker run uses
    And the vitest configuration the unit lane uses
    When their test file selections are compared
    Then the Stryker run leaves out extension/test/activePoolFreshnessAudit.test.js
    And it leaves out no other file the unit lane selects

  # BL-1771 bl1418-classification-test-passes-inside-a-stryker-shaped-sandbox-02
  Scenario: BL-1418's classification test passes when it runs from a Stryker-shaped sandbox
    Given a Stryker-shaped sandbox outside the repository whose directory is the extension root and whose parent links the repo-root siblings
    When bl1418RoleEnumerationClassification.test.js runs inside that sandbox
    Then every test in it passes
