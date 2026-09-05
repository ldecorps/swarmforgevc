# mutation-stamp: sha256=ea354dc19c4467be4cb85f48188111a42ccb8b02bcd5a6a455aa0a071ffea815
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T09:50:35.299745349Z","feature_name":"BL-1405 A hand-built land records its land approval","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1405-a-hand-built-land-records-its-land-approval.feature","background_hash":"77885d579a2721d3e47d2e4754f71606c2d0346700ea4e2ebc35e755244ec78d","implementation_hash":"unknown","scenarios":[{"index":1,"name":"the CLI refuses to record without both commits","scenario_hash":"f9c6723359bc433bdbdb08483e4324432a399d7c5aedd2d08bb07cdf5fab94a8","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-05T09:50:35.299745349Z"}]}
# acceptance-mutation-manifest-end

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
    Given an unapproved second source commit
    When the land-approval CLI records the replay against the unapproved source for ticket "BL-9009"
    Then the approval predicate still answers no for the replay

  # BL-1405 recording-twice-writes-one-line-04
  Scenario: recording the same replay twice leaves one line
    When the land-approval CLI records the replay against the source for ticket "BL-9009" twice
    Then the shared land-approval store holds exactly one line for the replay
