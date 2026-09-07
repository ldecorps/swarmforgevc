# mutation-stamp: sha256=723026d37bb89555e5931115bcd3615694192c14af166987062206a7c493a41d
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-07T14:43:40.605682071Z","feature_name":"BL-1461 The land step never calls a tip clean while an unlanded sibling sits anywhere in its unlanded history","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1461-the-land-step-never-calls-a-tip-clean-over-an-unlanded-sibling.feature","background_hash":"c427ce72467ccee0771fc39ff7c46bd9b64822580f768361dc62df0609d63d01","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a sibling's unlanded commit is reported wherever it sits relative to the parcel's hops","scenario_hash":"8c7452321da02f813244516467fda1e9e5c8aa53cae44c72dbea515a18c6e12e","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-07T14:43:40.605682071Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1461 The land step never calls a tip clean while an unlanded sibling sits anywhere in its unlanded history

  land-plan promises LAND_CLEAN when no entanglement is present. Its
  candidate walk starts at the parcel's last recorded hop (BL-1432's bound),
  so a sibling ticket's genuinely unlanded work absorbed into the parcel's
  history before that hop - the normal shape on a shared cleaner or
  architect branch, Article 2.6 - is never visited and never reported. On
  2026-09-07 both of BL-1448's real land inputs answered a bare LAND_CLEAN
  while carrying BL-1349's unlanded files; the wide walk found them. QA
  caught it only through an unrelated hand diff. BL-1446 keeps landed
  history out of the candidate set; this feature is the other direction:
  every commit reachable from the tip and not from origin/main is a
  candidate, wherever it sits relative to the parcel's hops, and the cost
  bound BL-1432 wanted is the re-point (BL-1438), not a shorter walk. Every
  scenario runs against a fixture repository under mkdtemp with its own
  origin (BL-1390).

  Background:
    Given a fixture repository with an origin, a main branch, and a shared batch-role branch carrying a parcel's five stage commits with the parcel's last hop recorded in the handoff archive

  # BL-1461 an-unlanded-sibling-is-reported-wherever-it-sits-01
  Scenario Outline: a sibling's unlanded commit is reported wherever it sits relative to the parcel's hops
    Given a sibling ticket's commit sits <position> and is not reachable from origin/main
    When the land step plans the parcel's tip
    Then the verdict is LAND_REPLAY naming the sibling as unlanded

    Examples:
      | position                                        |
      | before the parcel's first hop                   |
      | between the parcel's cleaner and architect hops |
      | after the parcel's last hop                     |

  # BL-1461 a-landed-sibling-is-still-never-a-candidate-02
  Scenario: the same sibling commit, once reachable from origin/main, is never a candidate
    Given a sibling ticket's commit sits between the parcel's cleaner and architect hops and is reachable from origin/main
    When the land step plans the parcel's tip
    Then the verdict is LAND_CLEAN

  # BL-1461 the-replay-carries-the-parcel-and-not-the-sibling-03
  Scenario: the replay forced by a pre-hop sibling carries every parcel path and none of the sibling's
    Given a sibling ticket's commit sits before the parcel's first hop and is not reachable from origin/main
    When the land step plans and builds the replay for the parcel's tip
    Then the replay tip carries every path the five stage commits changed, byte-identical to the cited tip
    And the replay tip carries no path the sibling's commit changed
