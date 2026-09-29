Feature: BL-1794 A stray an earlier stray in the same replay already landed is superseded

  A closed owner's post-land record reaches the role branches as several
  commits carrying the same change under different shas: the original,
  a copy re-applied by a merge-up or a re-point, and a follow-up that
  appends after it. The land step cherry-picks every such stray onto a
  scratch branch off origin/main, oldest first in the replay's own
  order. Once one copy and its follow-up have landed there, a later copy
  conflicts on lines the scratch branch already carries. Every superseded
  ground compares against origin/main, never against the scratch branch
  the replay has built so far, so none holds and the whole land
  escalates. Closed BL-1711's record fa79e88fa7 did this to BL-1785's
  and BL-1786's lands on 2026-09-29, and it arms every land after them.
  Every scenario runs against a fixture repository under mkdtemp with its
  own origin (BL-1390).

  Background:
    Given a fixture repository with an origin and a main branch
    And a sibling ticket closed on origin/main whose evidence file origin/main carries without a land section
    And a record commit on a role branch, whose subject leads with the sibling's id, appending a land section to that evidence file
    And a follow-up commit on the same role branch appending more lines after the land section

  # BL-1794 a-later-copy-of-a-landed-stray-is-superseded-01
  Scenario Outline: a later copy of a stray the replay already landed is superseded, not escalated
    Given a second copy of the record commit on another role branch, carrying <copy shape>
    And the landing ticket's own tip carries all three, with the second copy after the follow-up in the replay's order
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_REPLAY and prints LAND_STRAY_SUPERSEDED naming the second copy's commit with the reason "content-subset-of-replay-head"
    And the replay branch's tip carries the land section and the follow-up lines exactly once in the evidence file

    Examples:
      | copy shape                                         |
      | the same patch as the record commit                |
      | the evidence append alone, without its record edit |

  # BL-1794 a-copy-adding-a-line-the-replay-lacks-still-escalates-02
  Scenario: a later copy that adds a line the replay branch lacks still escalates by name
    Given a second copy of the record commit on another role branch that also adds a line no earlier stray carries
    And the landing ticket's own tip carries all three, with the second copy after the follow-up in the replay's order
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_ESCALATE and the reason names the second copy's commit
    And no LAND_STRAY_SUPERSEDED line names the second copy's commit
