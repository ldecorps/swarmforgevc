Feature: BL-1764 nightClosingCeremonyRun's unit tests never read the wall clock
  The ceremony runner keys a night on the local calendar day. A test that
  starts its ticks at the real current time and then advances 40 minutes
  lands on the next day whenever it runs within 40 minutes of local
  midnight, and the runner then starts a new night instead of finishing
  the first one. QA's unit lane on 2026-09-25 at 23:29 BST failed the three
  BL-1641 tests this way; the same file passes under TZ=UTC at that
  instant. Every test in the file starts from a fixed local date-time, so
  the file gives the same verdict at any hour in any time zone.

  Background:
    Given the unit test file "extension/test/nightClosingCeremonyRun.test.js"

  # BL-1764 ceremony-tests-read-no-wall-clock-01
  Scenario Outline: the file reads no wall clock
    When its source is scanned for "<clock read>"
    Then the scan finds 0 occurrences

    Examples:
      | clock read |
      | Date.now() |
      | new Date() |

  # BL-1764 ceremony-tests-read-no-wall-clock-02
  Scenario: no test or call is dropped to get there
    When its tests and runner calls are counted
    Then it declares at least 20 tests
    And it calls runNightClosingCeremony at least 32 times
