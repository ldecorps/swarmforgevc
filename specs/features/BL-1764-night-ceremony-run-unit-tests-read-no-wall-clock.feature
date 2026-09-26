# mutation-stamp: sha256=c952e1543b04b6dc953a91ee5fd32bb6b2391e71cf5624b22047c92fe867b1c7
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-26T00:07:57.645694555Z","feature_name":"BL-1764 nightClosingCeremonyRun's unit tests never read the wall clock","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1764-night-ceremony-run-unit-tests-read-no-wall-clock.feature","background_hash":"f1cfdec0a6307e053396748843665f3de8a38f31d17f585c652bfd360d6ac15f","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the file reads no wall clock","scenario_hash":"b1ff0e0ed7bad29f4f2523e681e8361d335f0b8e6bfc80147d233f1465de1b62","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-26T00:07:57.645694555Z"}]}
# acceptance-mutation-manifest-end

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
