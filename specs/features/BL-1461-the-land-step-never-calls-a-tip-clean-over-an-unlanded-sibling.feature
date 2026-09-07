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
