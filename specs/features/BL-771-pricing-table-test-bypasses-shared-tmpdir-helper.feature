Feature: Every extension test allocates its temp root through the shared helper
  BL-420's migration guard walks extension/test and fails on any raw
  fs.mkdtempSync(path.join(os.tmpdir(), ...)) outside its documented
  exemptions. It has been RED on main since 2026-07-28, because
  pricingTable.test.js:92 allocates its fixture repo root directly. BL-714
  migrated the four sites its bounce evidence happened to name rather than the
  set the guard actually reports, so this one survived and BL-714's own second
  invariant is unmet on main. The fix here is therefore defined by the sweep,
  not by a file list.
  Source: hardender note 2026-08-01 "pricingTable.test.js:92 raw mkdtempSync,
  5th BL-714-class site, ticket it".

  # BL-771 shared-tmpdir-helper-01
  Scenario: the guard reports no raw temp-root allocation anywhere it walks
    Given the raw-mkdtemp migration guard walks the real extension/test tree
    Then it reports zero raw mkdtemp call sites

  # BL-771 shared-tmpdir-helper-02
  Scenario: no file was exempted and no pattern narrowed to make the guard pass
    Given the raw-mkdtemp migration guard's own configuration is inspected
    Then its exempt paths are exactly helpers/tmpDir.js, tmpDirMigrationGuard.test.js and tmpDirMigrationGuard.property.test.js
    And it still flags a raw mkdtemp call planted in a fixture copy of pricingTable.test.js

  # BL-771 shared-tmpdir-helper-03
  Scenario: the migrated pricing-coverage test keeps its behavior and leaves no temp root behind
    Given a fixture repo whose swarmforge.conf names a model absent from the pricing table
    When the unpriced-model pricing coverage check runs against it
    Then it reports not ok and names that model
    And the fixture temp root does not survive the test file's teardown
