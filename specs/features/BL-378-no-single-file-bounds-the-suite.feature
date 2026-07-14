Feature: No single test file may silently become the suite's wall clock

  The suite's wall clock is "slowest file + ~1s": 250 files and 3,458 tests compress
  83s of file-time into 12.0s across 20 workers, and the median file is 14ms. So one
  file quietly growing to 10s costs as much as the other 249 combined — and nothing
  today reports it. BL-078/BL-252 already trend the WHOLE-suite duration, which is
  exactly the signal that cannot tell you a single file did this.

  Once BL-375/376/377 land, this guard is what stops the poles growing back, or a new
  file becoming the next one.

  # BL-378 no-single-file-bounds-the-suite-01
  Scenario: A file over the budget fails the guard
    Given a per-file duration budget
    When the guard sees a test file whose duration exceeds that budget
    Then the guard fails
    And it names the offending file, its duration, and the budget it broke

  # BL-378 no-single-file-bounds-the-suite-02
  Scenario: Every file within budget passes
    Given a per-file duration budget
    When the guard sees no test file exceeding that budget
    Then the guard passes

  # BL-378 no-single-file-bounds-the-suite-03
  Scenario: Every offender is named, not just the first
    Given a per-file duration budget
    When the guard sees more than one test file exceeding that budget
    Then it names every one of them

  # BL-378 no-single-file-bounds-the-suite-04
  Scenario: The guard actually runs, rather than sitting there uncalled
    When the project's normal verification command runs
    Then the guard runs as part of it, without being invoked by hand
