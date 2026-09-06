Feature: BL-1446 The land walk never counts landed history, and a replay carries every hop's work

  BL-1432 bounded the land step's attribution walk to the parcel by starting
  it at the task's last recorded handoff boundary instead of origin/main,
  promising the narrower walk only ever widens back, never changes a
  verdict. On 2026-09-06 it did both things the promise forbids. BL-1424's
  QA branch merged origin/main after the documenter-to-QA hop, so the range
  from that boundary to the tip contained a sibling's commits that were
  ALREADY on origin/main: the walk reported them as entangled and chose a
  replay, and the replay's own-path set, computed from the same boundary,
  held only QA's evidence edits - the coder, cleaner, architect and hardener
  work before the boundary was dropped, and a main tip without the parcel's
  guard was pushed (incident evidence
  backlog/evidence/BL-1424-land-replay-dropped-own-paths-incident-20260906.md).
  The wide walk, forced by hand, said LAND_CLEAN for the same tip. This
  feature is that a commit reachable from origin/main is never a candidate
  whatever the walk base, that a replay carries every path the parcel's own
  commits changed since its first hop, and that the bounded and wide walks
  agree. Every scenario runs against a fixture repository under mkdtemp
  with its own origin (BL-1390).

  Background:
    Given a fixture repository with an origin, a main branch, and a parcel branch carrying five stage commits for one ticket whose last hop is recorded in the handoff archive

  # BL-1446 landed-history-pulled-in-by-a-sync-is-not-entangled-01
  Scenario: a sibling landed on origin/main after the last hop and pulled in by a sync is never reported as entangled
    Given a sibling ticket's commit lands on origin/main after the parcel's last hop
    And the parcel branch merges origin/main
    When the land step plans the parcel's tip
    Then the verdict is LAND_CLEAN
    And the wide walk forced to origin/main gives the same verdict

  # BL-1446 a-replay-carries-every-hops-work-02
  Scenario: a replay forced by a genuinely unlanded sibling carries every path the parcel's five stage commits changed
    Given an unlanded sibling commit sits inside the parcel's own range
    And the parcel branch merges origin/main
    When the land step plans the parcel's tip
    Then the verdict is LAND_REPLAY
    And the replay tip carries every path the five stage commits changed, byte-identical to the cited tip

  # BL-1446 bounded-and-wide-walks-agree-03
  Scenario Outline: the bounded walk and the wide walk give the same verdict and the same own-paths for the same tip
    Given the parcel branch merges origin/main <syncs> times after its last hop
    When the land step plans the parcel's tip with the bounded walk and again with the walk forced to origin/main
    Then both verdicts are identical
    And both own-path sets are identical

    Examples:
      | syncs |
      | 0     |
      | 1     |
      | 2     |
