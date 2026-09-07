Feature: BL-1481 A shared path blocks a land only when the sibling's lines are not yet on main

  The land step refuses to replay a path that an unlanded, blocking sibling
  (bounced, withheld, unreadable) also touched in the tip's range, because a
  replay takes the path whole and would carry the sibling's lines onto main
  (BL-1332, narrowed by BL-1375). It decides "shared" by commit attribution
  alone: which commits in origin/main..tip touched the path. On 2026-09-07
  BL-1470's land was refused because BL-1348, bounced and not re-fixed,
  shares docs/reference/Specification.MD - yet every line BL-1348 ever added
  to that file was already on origin/main, carried there at 21:46 BST by
  BL-1473's whole-path land while the bounce check was still inert
  (BL-1466's root defect, the one BL-1470 fixes). The tip differed from main
  in that file by exactly BL-1470's own 20-line entry. Specification.MD is
  touched by every ticket's documenter, so one bounced sibling refuses every
  land until it is re-fixed. This feature is that the refusal reads content:
  a shared path is blocked only when the tip-versus-origin/main diff for
  that path carries a line attributable to the blocking sibling, and a path
  whose every changed line is the lander's own replays as before, with the
  report saying why.

  Background:
    Given a fixture repository under a scratch root with its own origin, a lander ticket and a bounced sibling that both touched one path

  # BL-1481 a-shared-path-blocks-only-when-the-siblings-lines-are-not-yet-on-main-01
  Scenario: a sibling whose lines are already on origin/main shares nothing and the path replays
    Given the sibling's lines in the shared path are present on origin/main and the tip adds only the lander's lines
    When the land plan is computed for the lander
    Then the plan is a replay that includes the shared path
    And the report names the sibling as content-clear for that path

  # BL-1481 a-shared-path-blocks-only-when-the-siblings-lines-are-not-yet-on-main-02
  Scenario: a sibling whose lines are in the tip but not on origin/main still blocks
    Given the shared path in the tip carries a line the bounced sibling added that origin/main lacks
    When the land plan is computed for the lander
    Then the plan is a refusal naming the path, the sibling and its bounce

  # BL-1481 a-shared-path-blocks-only-when-the-siblings-lines-are-not-yet-on-main-03
  Scenario: a line the sibling removed and origin/main still has also blocks
    Given the shared path in the tip lacks a line origin/main has because the bounced sibling deleted it
    When the land plan is computed for the lander
    Then the plan is a refusal naming the path, the sibling and its bounce

  # BL-1481 a-shared-path-blocks-only-when-the-siblings-lines-are-not-yet-on-main-04
  Scenario: an attribution the content check cannot read fails closed
    Given the blame of a changed line in the shared path cannot be read
    When the land plan is computed for the lander
    Then the plan is a refusal naming the path and the unreadable attribution
