# mutation-stamp: sha256=af30cb93f76ff0467a9e52035797d05e158ce4ca3b24b7fec9012244ebe91d48
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-31T00:11:24.513548065Z","feature_name":"An unlanded sibling reached only through a merge's second parent","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1308-an-unlanded-sibling-on-a-second-parent-is-invisible.feature","background_hash":"212826b91bef58bd2964debb3570c00459183cd24794056bb53344f1e6d303f4","implementation_hash":"unknown","scenarios":[{"index":0,"name":"A sibling is named wherever its commits sit in the ancestry","scenario_hash":"5ea88299c6bbdc6730cd2d9cd787e151dd39cfd6419fa9f0378e1c0864be3685","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-31T00:11:24.513548065Z"}]}
# acceptance-mutation-manifest-end

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
  merge of its own - the detector under-includes exactly where the path set
  over-includes: the sibling's id could stay off the report while its paths
  rode the replay anyway. BL-1389 (06f1babcaf, 2026-09-04) closed that half of
  the hole from the other side: the replay's own-path set now excludes a path
  only such an unlanded sibling owns, printing EXCLUDED_SIBLING_PATH for each
  one, so a foreign path never enters the replay unattributed in the first
  place. The detector's own sibling-naming behaviour below (scenarios 01-02,
  04) is unchanged by that fix.

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
  # Retired 2026-09-20 (BL-1654): this scenario's own premise - that an
  # unlanded sibling's path could ride the replay tip unattributed - was
  # closed by BL-1389 (06f1babcaf, 2026-09-04), which made the land step
  # exclude such a path outright and name it EXCLUDED_SIBLING_PATH. Red on
  # main since that fix landed (BL-1006's shape: the successor that
  # falsified the premise never retired the scenario built to catch it).
  # Replaced below by the scenario that pins the exclusion BL-1389 actually
  # performs, on the same second-parent fixture shape.
  # BL-1308 sibling-detector-covers-replay-content-03b
  # Names BL-1389 per BL-1654's own instruction, so the lineage stays
  # greppable from this feature file alone.
  Scenario: The replay tip carries only the cited ticket's own paths, and every excluded sibling path is named (BL-1389)
    Given a forward-merge whose subject names the cited ticket
    And an unlanded sibling ticket's untagged commits on that merge's second parent
    When the land step reports its siblings
    Then the sibling ticket is named in the report
    And the replay tip adds only the cited ticket's own paths
    And every sibling path left out of the replay is named on its own EXCLUDED_SIBLING_PATH line

  # BL-1308 sibling-detector-covers-replay-content-04
  # Preserves the posture entangled-siblings' existing warning path already
  # takes: an unanswered question reports entangled, never omits the sibling.
  Scenario: An ancestry that cannot be read escalates rather than landing
    Given the ancestry walk cannot be read
    When the land step decides
    Then the plan escalates for adjudication
    And no replay tip is landed
