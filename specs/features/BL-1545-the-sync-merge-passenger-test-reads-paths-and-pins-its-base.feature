Feature: BL-1545 The sync-merge passenger test reads :paths and pins its base

  test_bl1374_sync_merge_passengers.sh (BL-1374) drives the real land_step_lib.bb
  over real git fixtures and over the live history that produced BL-1374's
  report; the BL-1374 feature file's handler runs it. It has been red on main
  since 2026-09-04 with the lib answering correctly both times: case 01 greps
  the whole printed own-paths map for the passenger file and trips on the
  :excluded report key BL-1389 added, and case 05 walks from the live
  origin/main to a pinned tip that origin/main has since absorbed, so its range
  is empty and two absent checks pass vacuously. Reproducing it under git bisect
  run, which exports GIT_DIR, the test's un-proven fixture roots committed into
  the checkout it ran from and left a tA branch in the live repository. This
  feature is that the test is green against the real lib, reads the delivered
  :paths value, pins both ends of its live walk with a non-empty-range check,
  and proves every fixture root before mutating.

  Background:
    Given the standing test "swarmforge/scripts/test/test_bl1374_sync_merge_passengers.sh" which drives the real land_step_lib.bb over mkdtemp git fixtures and the live history

  # BL-1545 the-sync-merge-passenger-test-reads-paths-and-pins-its-base-01
  Scenario: the test is green on main and the BL-1374 contract it backs resolves again
    When the standing suite runs "swarmforge/scripts/test/test_bl1374_sync_merge_passengers.sh"
    Then the run exits zero and reports no failed check
    And every case from "01" to "05" reports at least one passed check
    And the acceptance run of "specs/features/BL-1374-a-sync-merge-is-not-credited-with-its-passengers.feature" resolves all 4 scenarios

  # BL-1545 the-sync-merge-passenger-test-reads-paths-and-pins-its-base-02
  Scenario: case 01 reads the delivered paths and asserts the passenger is reported excluded, not delivered
    When the standing suite runs "swarmforge/scripts/test/test_bl1374_sync_merge_passengers.sh"
    Then case "01" reports "shared.txt" absent from the delivered :paths value
    And case "01" reports "own.txt" present in the delivered :paths value
    And case "01" reports the :excluded entry for "shared.txt" naming owners "BL-9002" and "BL-9003"

  # BL-1545 the-sync-merge-passenger-test-reads-paths-and-pins-its-base-03
  Scenario: case 05 pins both ends of its live walk and refuses a census of zero
    When the standing suite runs "swarmforge/scripts/test/test_bl1374_sync_merge_passengers.sh"
    Then case "05" reports the walk from "3ea55a2e46" to "522584ed85" as a non-empty range before any absent check
    And case "05" reports "BL-1296" owning "backlog/active/BL-1296-bubble-answers-from-its-own-seat.yaml"
    And case "05" reports neither "BL-1309" nor "BL-1328" credited with it

  # BL-1545 the-sync-merge-passenger-test-reads-paths-and-pins-its-base-04
  Scenario: an inherited GIT_DIR cannot redirect a fixture into the checkout the test runs from
    Given a scratch clone of a tiny mkdtemp repository whose refs and status are recorded
    When the standing suite runs "swarmforge/scripts/test/test_bl1374_sync_merge_passengers.sh" with GIT_DIR exported as that clone's git directory
    Then the clone's refs and status are byte-identical to the recording, or the run aborted naming a fixture root
    And no branch "tA" exists in the repository the test ran from
