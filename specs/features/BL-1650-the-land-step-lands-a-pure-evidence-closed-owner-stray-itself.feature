Feature: BL-1650 The land step lands a pure-evidence closed-owner stray itself

  land-plan's landed-sibling verdict used to score a sibling only over
  task-tagged-changed-paths's own --first-parent walk, which never visits a
  commit that rode into the parcel's branch through a non-first-parent
  merge - the everyday shape every pipeline receive-merge produces. A
  sibling's content already on origin/main under a different sha then read
  ENTANGLED_SIBLING forever, and a candidate commit its own ticket had
  already disclaimed under abandoned_commits counted as evidence against it
  too. Separately, a closed sibling's incident-evidence file, committed on
  a role's own branch after the sibling moved on, is never anybody's
  content to land under the BL-1389 rule and BL-1546 refuses to decide it
  silently - correctly, but every later parcel whose branch carries that
  same stray commit escalates on it again, forever (BL-1636, 2026-09-19).
  The land step may now cherry-pick (`-x`, keeping the stray's own author
  and subject) such a stray itself, ahead of the parcel's own tip-pure
  replay, and report it LAND_STRAY_EVIDENCE_LANDED - narrowly, only when
  every path the stray touches is pure evidence/documentation; anything
  wider still refuses exactly as BL-1546 already does. QA bounce (D1,
  2026-09-20): a stray whose content is ALREADY on origin/main under a
  different commit (the everyday shape once a stray has been hand-landed
  once) makes `git cherry-pick -x` exit non-zero with "the previous
  cherry-pick is now empty" - git's own signal for nothing-to-commit, not
  a conflict. The pre-fix code aborted and escalated identically to a real
  conflict; it now skips the empty patch and reports
  LAND_STRAY_EVIDENCE_ALREADY_LANDED, and the replay proceeds. Every
  scenario runs against a fixture repository under mkdtemp with its own
  origin (BL-1390).

  Background:
    Given a fixture repository with an origin and a main branch

  # BL-1650 a-closed-owner-pure-evidence-stray-lands-with-the-parcel-01
  Scenario: a closed sibling's pure-evidence-only stray commit lands itself, ahead of the parcel's own replay
    Given a commit on a role branch, tagged with a sibling ticket id, touching only a path under backlog/evidence/
    And that sibling ticket is closed on origin/main
    And the landing ticket's own commit is on the same role branch
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_REPLAY and prints LAND_STRAY_EVIDENCE_LANDED naming the stray's own commit and its path
    And the sibling is reported LANDED_SIBLING, never ENTANGLED_SIBLING
    And the replay branch's tip carries the stray's own file content

  # BL-1650 a-closed-owner-stray-touching-code-still-refuses-02
  Scenario: a closed sibling's stray commit touching a path outside backlog/evidence/ and docs/ still refuses by name
    Given a commit on a role branch, tagged with a sibling ticket id, touching a path under swarmforge/scripts/
    And that sibling ticket is closed on origin/main
    And the landing ticket's own commit is on the same role branch
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_ESCALATE and the reason names that path and the closed sibling's id
    And no LAND_STRAY_EVIDENCE_LANDED line is printed

  # BL-1650 a-sibling-reaching-the-tip-only-via-a-merge-reads-landed-03
  Scenario: a sibling commit that reaches the tip only through a non-first-parent merge is reported landed when its content already matches origin/main
    Given origin/main already carries a path's content under its own commit
    And a sibling's own unrelated commit adds the same path with the same content
    And the landing ticket's branch merges the sibling's commit in as a non-first-parent ancestor
    When the land step runs for the landing ticket at the tip
    Then the sibling is reported LANDED_SIBLING, never ENTANGLED_SIBLING

  # BL-1650 a-sibling-whose-only-candidate-is-its-own-abandoned-commit-is-not-entangled-04
  Scenario: a sibling ticket that already recorded its only candidate commit under its own abandoned_commits is not entangled at all
    Given a sibling ticket closed on origin/main with abandoned_commits naming its own commit
    And that same commit later becomes an ancestor of the landing ticket's branch through an ordinary merge
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_CLEAN

  # BL-1650 an-already-landed-stray-replays-through-05
  Scenario: a stray whose content is already on origin/main under a different commit replays through instead of escalating (QA bounce D1)
    Given a commit on a role branch, tagged with a sibling ticket id, touching only a path under backlog/evidence/
    And that sibling ticket is closed on origin/main
    And origin/main already carries the stray's own file content under a separate commit
    And the landing ticket's own commit is on the same role branch
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_REPLAY and prints LAND_STRAY_EVIDENCE_ALREADY_LANDED naming the stray's own commit and its path
    And the sibling is reported LANDED_SIBLING, never ENTANGLED_SIBLING

  # BL-1650 a-stray-whose-tip-content-equals-main-is-landed-already-06
  # 2026-09-20: main's copy of the evidence file grew after the stray
  # commit; the tip carries main's copy; nothing is left to land.
  Scenario: a closed-owner stray commit whose path content on the replay tip already equals origin/main replays through with no cherry-pick
    Given a closed ticket's evidence commit off the lineage that added part of a file origin/main now carries in full
    And a replay tip whose copy of that file equals origin/main's
    When the land step replays the cited ticket
    Then no cherry-pick is attempted for the stray
    And the replay reports the sibling landed and lands the ticket's own paths
