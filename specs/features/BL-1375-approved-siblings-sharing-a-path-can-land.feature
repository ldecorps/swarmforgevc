Feature: Approved siblings sharing a path can land

  The land step refuses a tip entangled with an unlanded sibling, and builds a
  tip-pure replay instead. For a shared path a replayed path is taken whole, so
  a tip-pure commit for one ticket would carry its siblings' lines.

  Several APPROVED tickets sharing one path, none of them landed, is therefore
  circular: each refuses because the others are unlanded, and there is no order
  in which any of them can go first. Observed 2026-09-03 with four approved
  tickets on `specs/pipeline/steps/index.js`, three of which QA reported.

  Both escapes are closed and each for its own good reason: a combined
  multi-ticket commit is refused by the task-scope gate, and the land step takes
  one task name.

  The refusal itself is not wrong. It exists so a ticket's land never carries
  work the human has not approved. What must not happen is that it also blocks
  work the human HAS approved, with no way through.

  Background:
    Given several tickets share one path and none of them has landed

  # BL-1375 approved-siblings-sharing-a-path-can-land-01
  Scenario: approved siblings sharing a path are landable
    Given every sibling sharing the path is approved
    When the land step decides for one of them
    Then a land is available for that ticket

  # BL-1375 approved-siblings-sharing-a-path-can-land-02
  Scenario: an unapproved sibling still blocks
    Given one sibling sharing the path is awaiting approval
    When the land step decides for another of them
    Then the land is refused naming that sibling

  # BL-1375 approved-siblings-sharing-a-path-can-land-03
  Scenario: a withheld sibling still blocks
    Given one sibling sharing the path is withheld
    When the land step decides for another of them
    Then the land is refused naming that sibling

  # BL-1375 approved-siblings-sharing-a-path-can-land-04
  Scenario: nothing unapproved reaches main
    Given one sibling sharing the path is awaiting approval
    When any land proceeds for the approved siblings
    Then that sibling's lines are not on main
