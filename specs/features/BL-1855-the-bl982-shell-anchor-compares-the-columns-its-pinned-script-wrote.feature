Feature: BL-1855 The bl982 single-seat shell anchor compares the columns its pinned script wrote

  test_bl982_multi_seat_identity.sh case 7 is the fixed-configuration anchor
  for BL-982 invariant 2: a single-seat pack's roles.tsv is unchanged by the
  seat work. It diffs the current script's roles.tsv against the output of
  the pre-change swarmforge.sh, which is pinned by blob sha. Since 44d2d42591
  (2026-08-30) every roles.tsv row ends in a ninth column, the reverse-hop
  mode "forward-only". The pinned script can never write that column, so
  case 7 fails on every correct tree. BL-1541 already amended the same
  invariant in the property runner to compare the current rows projected
  onto the pinned script's first eight columns, and BL-1489 made the
  acceptance handler compare only the fields it names. Case 7 is the one
  copy left comparing whole rows. It now compares the same projection: an
  appended column is ignored, and an inserted, reordered or altered column
  among the first eight still fails.

  # BL-1855 the-bl982-shell-test-passes-01
  Scenario: the bl982 identity shell test passes while every row carries the appended propagation column
    Given the current swarmforge.sh writes "forward-only" as the ninth column of every roles.tsv row
    When test_bl982_multi_seat_identity.sh runs
    Then it exits 0
    And its output carries a "PASS: 7:" line

  # BL-1855 the-comparison-ignores-appended-and-catches-leading-02
  Scenario Outline: case 7's single-seat comparison ignores an appended column and catches a change among the first eight
    Given a roles.tsv row written by the pinned pre-change script
    And a current row that is that row with <difference>
    When case 7's single-seat comparison runs over the two rows
    Then the comparison <verdict>

    Examples:
      | difference                                   | verdict |
      | a ninth column "forward-only" appended       | passes  |
      | the seventh column "task" changed to "batch" | fails   |
      | an extra column inserted before the eighth   | fails   |
