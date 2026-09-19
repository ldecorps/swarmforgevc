Feature: BL-1651 The property lane names the file that exceeds its heap ceiling instead of dying

  The property lane spawns forks with a per-worker heap cap, and when a
  single property file fills that cap while running its generated cases,
  Node aborts the fork and the whole lane reports a crash with no file name
  and no number. Five parcels hit this on 2026-09-18 and 19, on unrelated
  files, one of them on a single-file run, while the host itself was never
  out of memory. After this parcel a file that exceeds a named per-file
  ceiling fails as that file with its peak heap in the message, the cap is
  derived from the host and printed once per run, and a committed census
  records every file's peak.

  Background:
    Given a fixture property test file that allocates and retains memory across its generated cases

  # BL-1651 a-file-over-the-ceiling-fails-by-name-01
  Scenario: a property file that exceeds the per-file heap ceiling fails as that file with its peak heap named
    Given the per-file heap ceiling is set to a value the fixture file will exceed
    When the property lane runs on the fixture file alone
    Then the run reports the fixture file as failed
    And the failure message names the file and its peak heap in megabytes
    And the worker that ran it is still alive at the end of the run

  # BL-1651 a-file-under-the-ceiling-passes-02
  Scenario: a property file that stays under the ceiling passes untouched
    Given the per-file heap ceiling is set to a value the fixture file will not reach
    When the property lane runs on the fixture file alone
    Then the run reports the fixture file as passed

  # BL-1651 the-cap-is-derived-from-the-host-and-printed-once-03
  Scenario: the per-worker cap and fork count are derived from the host and printed once per run
    When the property lane's budget is resolved for a host with 20 cores and 19 gigabytes of memory
    Then the resolved fork count times the per-worker cap does not exceed the memory available at spawn less the configured headroom
    And the derivation is printed exactly once at the start of a run

  # BL-1651 the-census-is-committed-with-its-run-context-04
  Scenario: the committed heap census carries every file's peak heap and the run's cap, fork count and load
    When extension/test/property-lane-heap-census.txt is read on the parcel commit
    Then it lists one row per property test file with its peak heap in megabytes and its case count
    And its header states the cap, the fork count and the host load of the run that produced it
