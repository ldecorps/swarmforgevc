Feature: An unlanded sibling reached only through a merge's second parent

  BL-1241 gave the land step a remedy for an entangled tip: name the sibling
  tickets in the cited commit's ancestry, then rebuild a tip-pure replay of
  the cited ticket's own paths. Two different walks answer those two halves,
  and they do not cover the same commits.

  The sibling DETECTOR (`entangled-siblings` -> `ancestry-commits` in
  `swarmforge/scripts/land_step_lib.bb`) walks
  `rev-list --first-parent origin/main..<tip>`. The replay's own-path set asks
  `own-commit-changed-paths` for `:delivered`, which for a merge diffs it
  against its FIRST parent - so it draws in every path that merge's SECOND
  parent brought with it, whoever authored them.

  A role's forward-merge takes its subject from the ticket it is forwarding.
  So when an earlier ticket's commits ride into that merge on the second
  parent - because that ticket is still parked upstream and never got a tagged
  merge of its own - its paths enter the replay while its id never reaches the
  report.
  The detector under-includes exactly where the path set over-includes, so the
  safety net has a hole shaped like the thing it is meant to catch.

  Verified 2026-08-30 on BL-1307's documenter tip `bd27e884cb`: the detector
  named BL-1288, BL-1293 and BL-1299 and never named BL-1300, whose commits
  `9553cf9354` and `3fe063d3ad` are ancestors of that tip but score zero hits
  on the first-parent walk. The replay `c251bb4b666d` carried four BL-1300
  files absent from `origin/main`, while BL-1300 was being held unlanded for a
  human ruling.

  Background:
    Given a cited tip whose land step is asked for a plan

  # BL-1308 sibling-detector-covers-replay-content-01
  Scenario Outline: A sibling is named wherever its commits sit in the ancestry
    Given an unlanded sibling ticket's commits reachable <position>
    When the land step reports its siblings
    Then the sibling ticket is named in the report

    Examples:
      | position                                    |
      | on the first-parent walk from origin/main   |
      | only through a merge's second parent        |

  # BL-1308 sibling-detector-covers-replay-content-02
  # The exact shape that produced the 2026-08-30 hold: a forward-merge whose
  # subject names the cited ticket, carrying an earlier ticket's untagged
  # commits on its second parent.
  Scenario: A forward-merge subject does not hide what its second parent carried
    Given a forward-merge whose subject names the cited ticket
    And an unlanded sibling ticket's untagged commits on that merge's second parent
    When the land step reports its siblings
    Then the sibling ticket is named in the report

  # BL-1308 sibling-detector-covers-replay-content-03
  Scenario: A replay tip carries no path from a ticket the report did not name
    Given the replay tip adds a path that is absent from origin/main
    When the land step decides
    Then the ticket that path is attributed to is named in the report

  # BL-1308 sibling-detector-covers-replay-content-04
  # Preserves the posture entangled-siblings' existing warning path already
  # takes: an unanswered question reports entangled, never omits the sibling.
  Scenario: An ancestry that cannot be read escalates rather than landing
    Given the ancestry walk cannot be read
    When the land step decides
    Then the plan escalates for adjudication
    And no replay tip is landed
