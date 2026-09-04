Feature: BL-1405 A hand-built land records its land approval

  The land step records which approved source a tip-pure replay stands in
  for, and the one shared approval predicate reads that record. The
  hand-built land route had no way to write it, so every hand-built replay
  read as unapproved the moment it landed. This feature is that a CLI records
  the mapping through the land step's own writer, that the predicate then
  answers approved for the replay, and that a record can never grant more
  than its source already has.

  Background:
    Given a fixture repository with a QA ref, an approved source commit, and a hand-built replay of it on main

  # BL-1405 a-recorded-replay-answers-approved-01
  Scenario: recording the replay against its approved source makes the predicate answer approved
    Given the approval predicate answers no for the replay
    When the land-approval CLI records the replay against the source for ticket "BL-9009"
    Then the shared land-approval store gains one line naming the replay, the source and the ticket
    And the approval predicate answers approved for the replay

  # BL-1405 a-missing-sha-is-refused-02
  Scenario Outline: the CLI refuses to record without both commits
    When the land-approval CLI is run with <missing> omitted
    Then the CLI exits non-zero naming what is missing
    And the shared land-approval store is unchanged

    Examples:
      | missing     |
      | the replay  |
      | the source  |

  # BL-1405 a-record-grants-nothing-on-its-own-03
  Scenario: a record naming an unapproved source grants the replay nothing
    Given a source commit the approval predicate answers no for
    When the land-approval CLI records the replay against that source for ticket "BL-9009"
    Then the approval predicate still answers no for the replay

  # BL-1405 recording-twice-writes-one-line-04
  Scenario: recording the same replay twice leaves one line
    When the land-approval CLI records the replay against the source for ticket "BL-9009" twice
    Then the shared land-approval store holds exactly one line for the replay
