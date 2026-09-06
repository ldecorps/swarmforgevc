Feature: BL-1443 A property test's tree walk skips a file that vanished between listing and read

  Property tests run in one concurrent pool. bl868 and bl984 write transient
  fixture files named bl868-fixture-<pid>-<rand>.property.test.js into
  extension/test/ (propertyLaneFixtureRunner.js) and remove them when their
  spawned vitest returns. bl874 walks the whole repository, listing each
  directory and then reading every .js file it listed. On 2026-09-06 QA's
  full run failed bl874 with ENOENT opening a bl868 fixture that had been
  listed and then removed by its owner - a race between one test's walk and
  another test's fixture lifetime, on a domain the parcel under review did
  not touch. It passed on the next run. Nine property files carry an inline
  recursive walk today and any of them that reads under extension/test/ can
  fail the same way.

  This feature is that the property lane walks a live tree through one shared
  helper that treats a file vanishing between listing and read as "not there"
  and skips it, that no other read error is swallowed by that tolerance, and
  that no property test keeps an inline walk of its own.

  # BL-1443 a-vanished-file-is-skipped-01
  Scenario: a file removed after listing but before reading is skipped, not an error
    Given a scratch tree of four .js files under a mkdtemp root
    And one of them is removed after the walk has listed its directory and before it is read
    When the tree is walked through the property-lane helper
    Then the walk completes and reports the three files that still exist
    And nothing was written, moved or deleted by the helper itself

  # BL-1443 other-read-errors-still-fail-02
  Scenario Outline: a read failure that is not a vanished file still fails the walk
    Given a scratch tree of four .js files under a mkdtemp root
    And reading one of them fails with <error> through the helper's fs seam
    When the tree is walked through the property-lane helper
    Then the walk fails naming that file and <error>

    Examples:
      | error  |
      | EACCES |
      | EISDIR |

  # BL-1443 no-property-test-walks-inline-03
  Scenario: every property test that walks a live tree goes through the helper
    Given the property test files under extension/test
    When each file is scanned for an inline recursive directory walk
    Then no property test defines its own walk
    And every property test that walks a tree calls the helper
