Feature: BL-1807 A lane land that names no ticket publishes when every path is inside its lane

  Human ruling B (2026-09-06, BL-1444) has QA land the Art Director's tip
  on its note, and ruling A (2026-09-07, BL-1459) the documenter's
  briefing, each with a landing subject that names no ticket
  (`Land art-director tip <10-hex>`, `Land documenter briefing <10-hex>`).
  BL-1678 (2026-09-21) made the publish step refuse every pushed commit
  whose own subject names no ticket, so neither lane land can publish as
  QA.prompt writes it: Art Director tip 3d8d7563c7 was refused on
  2026-09-29, the first lane land since BL-1678. A lane land is known by
  its subject, and passes the publish step only when every path it
  changes against origin/main is inside that subject's lane - the same
  lane the lane's own tip guard judges (check_art_director_tip.sh,
  check_documenter_briefing_tip.sh). Every other ticketless commit is
  refused exactly as before. Fixtures are their own repositories under
  mkdtemp with their own bare origin, never the live one (BL-1390).

  Background:
    Given a fixture repository whose origin/main resolves

  # BL-1807 a-lane-land-inside-its-lane-publishes-01
  Scenario Outline: a lane land whose every path is inside its lane publishes
    Given a single-parent commit off origin/main with the subject "<subject>" that changes only <path>
    When the publish step is asked whether that commit may be pushed as main
    Then it answers LAND_PUBLISH_OK

    Examples:
      | subject                              | path                                                            |
      | Land art-director tip 3d8d7563c7     | docs/design/briefs/2026-09-28-headless-briefing-wall-of-text.md |
      | Land art-director tip 3d8d7563c7     | backlog/evidence/BL-1419-art-director-20260928.md               |
      | Land documenter briefing 8c67e0eefc  | docs/briefings/2026-09-30.md                                    |

  # BL-1807 a-lane-land-outside-its-lane-is-refused-02
  Scenario Outline: a lane land carrying a path outside its lane is refused naming that path
    Given a single-parent commit off origin/main with the subject "<subject>" that changes only <lane path> and <outside path>
    When the publish step is asked whether that commit may be pushed as main
    Then it answers LAND_PUBLISH_REFUSED naming <outside path>

    Examples:
      | subject                              | lane path                    | outside path                             |
      | Land art-director tip 3d8d7563c7     | docs/design/system.md        | extension/src/tools/rework-observatory.ts |
      | Land art-director tip 3d8d7563c7     | docs/design/system.md        | backlog/evidence/BL-1419-QA-20260928.md  |
      | Land documenter briefing 8c67e0eefc  | docs/briefings/2026-09-30.md | docs/briefings/.sent.json                |

  # BL-1807 a-subject-declaring-no-lane-is-still-refused-03
  Scenario Outline: a ticketless commit whose subject declares no lane land is still refused as naming no ticket
    Given a single-parent commit off origin/main with the subject "<subject>" that changes only docs/design/system.md
    When the publish step is asked whether that commit may be pushed as main
    Then it answers LAND_PUBLISH_REFUSED saying the commit names no ticket in its own subject

    Examples:
      | subject                                                                            |
      | Rename the 2026-09-28 headless-briefing brief to fit the 80-char note message limit |
      | Land art-director tip                                                              |

  # BL-1807 a-lane-land-merge-commit-is-still-refused-04
  Scenario: a lane land that is a merge commit is still refused
    Given a two-parent commit with the subject "Land art-director tip 3d8d7563c7" whose changes against origin/main are all under docs/design/
    When the publish step is asked whether that commit may be pushed as main
    Then it answers LAND_PUBLISH_REFUSED saying a merge commit is never pushed as main
