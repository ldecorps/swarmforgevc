Feature: BL-1849 A property scan of the test directory skips a fixture that vanished

  bl1061's invariant 2 guards that no committed test fixture binds a
  production tunnel name. It lists extension/test, then stats and reads
  every .js file it listed. In the same property run, bl868's lane writes
  fixture files named bl868-fixture-<pid>-<rand>-<n>.property.test.js into
  that directory and removes them when its spawned vitest returns. On
  2026-09-30 QA's run failed the guard with ENOENT on the stat of one such
  fixture: listed, then removed by its owner before the stat. It was a race
  between two tests in one directory, not a tunnel-name finding.
  BL-1443 built the shared walk that treats a file vanishing between listing
  and read as not there. This scan never moved onto it, and neither did two
  siblings, because BL-1443's census matched only walks named "walk". The
  guard now reads the directory through that tolerance: a vanished fixture
  is skipped, a real binding is still reported, and no other read error is
  swallowed.

  # BL-1849 a-vanished-fixture-is-skipped-01
  Scenario: a fixture removed after the listing and before its read is skipped, not an error
    Given a scratch test directory holding "bl868-fixture-11637-1yyx5u0myft-2.property.test.js" and a file that binds the tunnel name "swarmforge-bubble"
    And the fixture is removed after the scan has listed the directory and before it is read
    When the tunnel-binding scan runs over the scratch directory
    Then the scan completes
    And it reports exactly the file that binds "swarmforge-bubble"

  # BL-1849 other-read-errors-still-fail-02
  Scenario: a read failure that is not a vanished file still fails the scan
    Given a scratch test directory holding a file whose read fails with EACCES through the scan's fs seam
    When the tunnel-binding scan runs over the scratch directory
    Then the scan fails naming that file and EACCES
