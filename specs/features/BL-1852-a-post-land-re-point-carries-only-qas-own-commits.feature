Feature: BL-1852 A post-land re-point carries only QA's own commits

  After a land, the QA branch is re-pointed onto origin/main, and the
  commits QA made that are not on origin/main yet are re-applied on top
  (BL-1438). The keep rule re-applied every other-ticket bookkeeping
  commit reachable from QA's old tip, including the evidence commits
  that came in through a merged parcel's lineage. On 2026-09-30 the kept
  set grew from 47 to 2299 commits across one day's re-points. Since the
  previous re-point, QA had made 6 commits on its own first-parent line;
  the rest came in through merges. Each re-application gives those
  commits new ids, and the next land walks them all. A re-point now
  carries QA's own commits, including those an earlier re-point carried
  forward. A commit that came in through a merge comes back with its own
  parcel.

  Background:
    Given a fixture repository with its own bare origin and a QA branch last re-pointed onto origin/main

  # BL-1852 a-merged-lineage-is-not-re-applied-01
  Scenario: a re-point re-applies QA's own commits and none that came in through a merge
    Given QA has since made 3 commits of its own
    And QA has merged a parcel whose lineage holds 40 evidence commits of other tickets that are not on origin/main
    When the post-land re-point runs
    Then it re-applies exactly QA's 3 commits
    And the new QA tip is 3 commits ahead of origin/main

  # BL-1852 qas-carried-commits-are-carried-again-02
  Scenario: QA's own commits that an earlier re-point carried are carried again
    Given the last re-point carried 2 of QA's own commits and 30 evidence commits that had come in through a merge, recorded the way land-repoint.log records it on 2026-09-30
    And QA has since made 1 commit of its own
    When the post-land re-point runs
    Then it re-applies QA's 3 commits and none of the 30

  # BL-1852 a-landed-qa-commit-is-not-re-applied-03
  Scenario: a QA commit whose change has already reached origin/main is not re-applied
    Given QA has since made 2 commits of its own
    And the change of one of them has since landed on origin/main
    When the post-land re-point runs
    Then it re-applies only the commit whose change has not landed
