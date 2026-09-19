Feature: BL-1648 The register CLI takes an injected date so an age scenario is never a time bomb

  BL-1428's acceptance scenario 01 asserts that the oldest register row is
  35 days old, for a fixture row first seen 2026-08-01, while the register
  CLI always reads today's date. The assertion was true on the day the
  feature was stamped and false every day after; it surfaced on 2026-09-19
  when a change to the register's commit guard pulled the feature into the
  changed-path lane. After this parcel the CLI accepts an injected date,
  BL-1428's scenario reads its fixture as of a pinned day, and no age a
  scenario checks depends on the real clock.

  Background:
    Given a fixture root with a standing-red register whose oldest row was first seen 2026-08-01 and a backlog holding an open ticket for it

  # BL-1648 a-pinned-date-gives-a-pinned-age-01
  Scenario: with an injected date the age is deterministic
    When the register CLI reads the fixture root as of 2026-09-05
    Then the report's oldest age in days is 35

  # BL-1648 no-date-means-today-02
  Scenario: with no injected date the CLI reads today
    Given a register row first seen on the current date
    When the register CLI reads the fixture root with no date given
    Then that row's age in days is 0

  # BL-1648 an-injected-date-never-changes-rows-or-owners-03
  Scenario: an injected date changes only the age arithmetic
    When the register CLI reads the fixture root as of 2026-09-05 and again as of 2026-12-01
    Then both reports list the same rows with the same owners and the same owned flags
    And only the ages differ

  # BL-1648 a-malformed-date-is-refused-04
  Scenario: a malformed injected date is refused rather than silently replaced by today
    When the register CLI reads the fixture root as of "yesterday"
    Then it exits non-zero naming the date argument
    And it prints no report
