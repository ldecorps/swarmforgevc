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

  Consulting approval state is more state to read, and so more ways to be
  wrong. A sibling whose approval state cannot be read is not thereby approved:
  a check that could not run is never scored as "nothing found".

  Approved means approved to be WORKED, not landed. Until BL-1830, once an
  approved sibling stopped blocking, its shared-path lines rode into main as
  a passenger, so the replayed tree had to be checked for self-consistency
  before publish - a require line arriving ahead of its handler file froze
  every commit on main once already.

  BL-1830 (the human's ruling A, 2026-09-30) rebuilds a shared own path from
  origin/main plus only the landing ticket's own changes, so no unlanded
  sibling's line rides, approved or not. Scenarios 06 and 07 asserted a
  passenger riding through a self-consistent tree; they are retired (never
  reworded - BL-1006) by the BL-1876 hotfix. Scenario 01 still holds: an
  approved sibling no longer blocks, and the land rebuilds the shared path
  without its lines.

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

  # BL-1375 approved-siblings-sharing-a-path-can-land-05
  Scenario: a sibling whose approval state cannot be read still blocks
    Given one sibling sharing the path has no readable approval state
    When the land step decides for another of them
    Then the land is refused naming that sibling
