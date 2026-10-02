Feature: BL-1901 A parcel line that carries only its own ticket lands as a merge of origin/main and a fast-forward push

  The human's ruling A on BL-1870 (2026-10-01): landing a parcel that
  travels on its own line "should not be much more than a git merge". The
  lander (BL-1872) still runs the whole land step for every parcel, and
  since BL-1678 the land step rebuilds even an untangled parcel by
  cherry-picking its paths onto origin/main. All 53 land records written
  on 2026-10-01 and 2026-10-02 are rebuilds, and BL-1887's took an hour.
  A queued line whose every commit since origin/main names only the
  landing ticket, or merges origin/main in, now lands as one merge of
  origin/main and a fast-forward push. Any other line goes through the
  land step exactly as before.

  Background:
    Given a fixture project with a bare origin and a lander queue

  # BL-1901 a-clean-line-lands-as-a-merge-01
  Scenario: a clean line behind origin/main lands as a merge of origin/main, with no rebuild
    Given origin/main has moved on since BL-9001's line was cut
    And the lander queue holds an entry for BL-9001 whose line carries only BL-9001 commits and merges of origin/main
    When the lander sweep runs until the queue is empty
    Then origin/main's tip is a merge whose parents are the queued commit and the previous origin/main tip
    And the land step did not run
    And the land record for BL-9001 names the queued commit as its source and the merge path

  # BL-1901 a-clean-line-already-on-top-fast-forwards-02
  Scenario: a clean line that already contains origin/main lands by fast-forward
    Given the lander queue holds an entry for BL-9001 whose line carries only BL-9001 commits on top of origin/main
    When the lander sweep runs until the queue is empty
    Then origin/main's tip is the queued commit
    And the land step did not run

  # BL-1901 any-other-line-takes-the-land-step-03
  Scenario Outline: a line the merge path does not accept goes through the land step as before
    Given the lander queue holds an entry for BL-9001 whose line <carries>
    When the lander sweep runs until the queue is empty
    Then the land step ran for BL-9001
    And the land record for BL-9001 names the land-step path

    Examples:
      | carries                                                    |
      | also carries an unlanded BL-9002 commit                    |
      | also carries a commit that names no ticket and is no merge |
      | conflicts with origin/main when merged                     |
