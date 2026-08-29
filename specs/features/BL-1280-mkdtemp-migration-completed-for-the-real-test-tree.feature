# BL-420 introduced a shared temp-dir helper (extension/test/helpers/tmpDir.js)
# so every fixture root is swept exactly once, and a guard test that scans the
# REAL extension/test tree for raw `fs.mkdtempSync(path.join(os.tmpdir(), ...))`
# call sites. The guard was built; the migration it gates was never finished.
#
# Measured on main 2026-08-29: 34 violations across 25 files.
# `cd extension && npx vitest run test/tmpDirMigrationGuard.test.js` -> 1 failed,
# 10 passed. The file is NOT a *.property.test.js, and vitest.config.mjs excludes
# only that pattern, so this red sits in the DEFAULT unit lane.
#
# Triaged line by line rather than in bulk, because the two kinds need opposite
# treatment:
#
#   33 REAL call sites across 24 files - ordinary `const root =
#   fs.mkdtempSync(...)` that should allocate through the helper. 23 of those
#   files do not import the helper yet. None sits in a beforeAll (0 of 33), one
#   is in a beforeEach and the rest are in test bodies or local helper
#   functions, so `mkTmpDir` is the correct variant throughout - not
#   `mkSharedTmpDir` or `mkProcessTmpDir`.
#
#   1 FIXTURE STRING - pilotMkdtempConventionCheck.test.js:27, where the raw
#   pattern is written into a scratch file as test DATA, to prove
#   assessPilotMkdtempConvention detects it. Rewriting that string destroys the
#   test. It must stay a raw pattern, and must stop being contiguous.
#
# Proven before minting: applying the mechanical migration to the 24 real files
# in a scratch copy of extension/test drops the guard from 34 violations to
# exactly 1 - the fixture string.
#
# It is not BL-1209's, and it is not new. Every flagged line already stood
# unchanged at f6d369da3, the tip before BL-1209's first commit; BL-1209 never
# touched agentNotesCore.test.js, which carries five of the violations.

Feature: The raw-mkdtemp migration is finished for the real extension/test tree

  Background:
    Given the shared temp-dir helper at extension/test/helpers/tmpDir.js

  # BL-1280 mkdtemp-migration-completed-for-the-real-test-tree-01
  Scenario: the real test tree has no raw mkdtemp call sites left
    When the guard scans the real extension/test tree
    Then it reports zero violations

  # BL-1280 mkdtemp-migration-completed-for-the-real-test-tree-02
  Scenario: the fix does not blunt the detector
    Given a scratch test tree containing one raw mkdtemp call site
    When the guard scans that tree
    Then it reports that call site

  # BL-1280 mkdtemp-migration-completed-for-the-real-test-tree-03
  Scenario: a file carrying the raw pattern as test data is not exempted wholesale
    When the guard's file-level exempt list is read
    Then it names exactly the three paths it documented before this change
    And "pilotMkdtempConventionCheck.test.js" is not among them

  # BL-1280 mkdtemp-migration-completed-for-the-real-test-tree-04
  Scenario: the convention checker still proves it detects a planted raw call
    When the pilot mkdtemp convention check runs against a planted raw call site
    Then it reports exactly one violation
