Feature: BL-1473 A replay never deletes or resurrects a path the parcel never touched

  own-paths starts from the two-tree diff between origin/main and the tip,
  chosen by BL-1315 so that content which reached the branch before its
  own tagged merge is still delivered. A two-tree diff also lists every
  path origin/main gained after the branch forked, as absent at the tip,
  and every path origin/main deleted since, as present at the tip. On
  2026-09-07 BL-1463's replay proposed deleting the YAML files of BL-1470
  and BL-1471, two tickets minted on main minutes earlier that no commit
  of BL-1463 ever touched; only the merge-deletion guard's refusal stopped
  the replay from landing those deletions. A path is the parcel's to
  deliver only when a commit in the parcel's own range touched it: a
  deletion only when the parcel deleted it, an addition only when the
  parcel added or changed it. Every scenario runs against a fixture
  repository under mkdtemp with its own origin (BL-1390).

  Background:
    Given a fixture repository with an origin, a main branch, a parcel branch forked from it, and a tip-pure land planned for the parcel

  # BL-1473 a-path-main-gained-after-the-fork-is-never-a-deletion-01
  Scenario: a path origin/main gained after the fork is never proposed as the parcel's deletion
    Given origin/main gained a file after the parcel branch forked and no commit of the parcel touched it
    When the land step computes the parcel's own paths
    Then that file is not in the own-path set
    And the built replay leaves it exactly as origin/main has it

  # BL-1473 a-path-main-deleted-after-the-fork-is-never-resurrected-02
  Scenario: a path origin/main deleted after the fork is never resurrected by the replay
    Given origin/main deleted a file after the parcel branch forked and no commit of the parcel touched it
    When the land step computes the parcel's own paths
    Then that file is not in the own-path set
    And the built replay does not restore it

  # BL-1473 the-parcels-own-deletion-is-still-delivered-03
  Scenario: a file the parcel itself deleted is still delivered as a deletion
    Given a commit in the parcel's own range deleted a file that origin/main still has
    When the land step computes the parcel's own paths
    Then that file is in the own-path set and the built replay removes it

  # BL-1473 content-that-arrived-before-the-tagged-merge-is-still-delivered-04
  Scenario: content that reached the branch before the parcel's own tagged merge is still delivered
    Given the parcel's content reached the branch through a merge that predates its tagged merge, as in BL-1315
    When the land step computes the parcel's own paths
    Then every one of those paths is in the own-path set
