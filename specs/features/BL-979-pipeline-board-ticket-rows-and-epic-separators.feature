Feature: BL-979 the pipeline board renders tickets as rows with epic separators in the caption list

  BL-585's matrix puts each active ticket in its own COLUMN and the pipeline
  stages in shared rows, so the board grows sideways with every new active
  ticket - and phone width is the scarce axis. This pivots the axis back:
  tickets become rows, the eight stages become shared columns flowing left to
  right (NS SP CO CL AR HD DC QA). Below the grid the per-ticket captions keep
  BL-956's content (display id + truncated full title) but are grouped under
  "-- <epic-slug> --" separators with a blank line before every ticket summary.
  Human-approved mockup, 2026-08-20.

  Background:
    Given a pipeline board rendered from the active backlog

  # BL-979 pipeline-board-ticket-rows-and-epic-separators-01
  Scenario: the matrix has one row per active ticket and one shared stage header
    Given active tickets held at distinct pipeline stages
    When the board grid renders
    Then the header row lists the stage glyphs "NS SP CO CL AR HD DC QA" left to right
    And each active ticket occupies exactly one row labelled with its display id
    And each row marks "X" in its held stage column and "." in every other

  # BL-979 pipeline-board-ticket-rows-and-epic-separators-02
  Scenario: captions are grouped under epic separators with a blank line before each summary
    Given active tickets belonging to more than one epic
    When the board caption list renders
    Then each epic group opens with a separator line "-- <epic-slug> --"
    And every ticket summary is preceded by a blank line
    And each summary line is the display id followed by the truncated ticket title

  # BL-979 pipeline-board-ticket-rows-and-epic-separators-03
  Scenario Outline: the epic-less bucket
    Given active tickets where <epic_membership>
    When the board caption list renders
    Then the caption list <separator_expectation>

    Examples:
      | epic_membership                            | separator_expectation                                    |
      | some tickets carry no epic and others do   | ends with a "-- (no epic) --" group holding those tickets |
      | no ticket carries an epic at all           | contains no separator line                                |

  # BL-979 pipeline-board-ticket-rows-and-epic-separators-04
  Scenario: rows beyond the height budget are dropped visibly, never silently
    Given more active tickets than the board's row budget allows
    When the board grid renders
    Then the visible rows are the leading tickets of the same epic-grouped order
    And a "+N more active" line names how many rows were dropped
    And the caption list covers exactly the visible rows

  # BL-979 pipeline-board-ticket-rows-and-epic-separators-05
  Scenario Outline: the grid width is fixed by the stages, so a wider id never drops a row
    Given every active ticket's display id is <id_width> characters wide
    And the active ticket count is within the row budget
    When the board grid renders
    Then no row is dropped for width
    And the widest grid line is at most the board's grid width budget

    Examples:
      | id_width |
      | 3        |
      | 4        |
      | 5        |

  # BL-979 pipeline-board-ticket-rows-and-epic-separators-06
  Scenario Outline: caption content is unchanged by the pivot
    Given an active ticket whose backlog entry is <backlog_entry>
    When the board caption list renders
    Then its summary line reads "<summary>"

    Examples:
      | backlog_entry                          | summary                    |
      | a title longer than the caption budget | 948 <truncated title>…     |
      | absent                                 | 948 (no backlog entry)     |
