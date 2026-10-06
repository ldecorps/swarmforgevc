Feature: BL-2037 A local seat's phase record carries its notes between arrange, act and assert

  A local model's window is too small to read a ticket, find what to
  change, change it and check it in one session. Each parcel on a
  local-model seat runs in phases: arrange gathers what the change needs,
  act makes the change from the arrange notes, assert checks it against
  the ticket. Each phase runs in a fresh session, so what one phase learns
  reaches the next only through the parcel's phase record: a file in the
  seat's worktree holding the current phase, the count of failed asserts
  and the notes every phase has written. This feature is the record and
  the command that moves it. Restarting the session at each move and
  telling the served parcel its phase is BL-2038.

  Background:
    Given a fixture worktree for a local-model seat holding a parcel for BL-9001

  # BL-2037 a-parcel-starts-in-arrange-01
  Scenario: a parcel with no phase record starts in arrange
    When the seat asks the phase command for BL-9001's phase
    Then the phase is "arrange" with 0 failed asserts

  # BL-2037 ending-a-phase-moves-the-record-02
  Scenario Outline: ending a phase moves the record by the phase order and keeps every note
    Given BL-9001's phase record is in "<from>" with <failed> failed asserts
    When the seat ends that phase with "<outcome>" and a note
    Then <result>
    And the record's notes end with that note, after every earlier note

    Examples:
      | from    | failed | outcome        | result                                                                          |
      | arrange | 0      | more arrange   | the record is in "arrange" with 0 failed asserts                                |
      | arrange | 0      | ready to act   | the record is in "act" with 0 failed asserts                                    |
      | arrange | 0      | no code change | the record is in "assert" with 0 failed asserts                                 |
      | act     | 0      | done           | the record is in "assert" with 0 failed asserts                                 |
      | assert  | 0      | failed         | the record is in "act" with 1 failed asserts                                    |
      | assert  | 1      | failed         | the record is in "act" with 2 failed asserts                                    |
      | assert  | 2      | failed         | the record stays in "assert" and the command prints a split request for BL-9001 |
      | assert  | 0      | passed         | the record is in "done" with 0 failed asserts                                   |
