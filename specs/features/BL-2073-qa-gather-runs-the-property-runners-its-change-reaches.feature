Feature: BL-2073 QA's gather runs the property runners its change reaches

  About 200 of the 217 property runners under swarmforge/scripts/test run
  only when a role picks one by hand (QA note 003876), and no lane runs
  them (BL-2041's sibling). The human's ruling A, carried by BL-2049
  (landed): "QA's gather runs, on every parcel, the property runners its
  change reaches, and nothing runs the others." The reach selector and
  the front-end's --changed-from flag are BL-2049's; this slice gives the
  gather the row that runs them: on every parcel the gather runs
  run_property_runners.sh --changed-from <ref> with the parcel's own
  merge-base with main, so a red the parcel causes shows in the gather
  QA already reads, before the land.

  # BL-2073 a-parcel-that-reaches-runners-runs-exactly-them-01
  Scenario Outline: a parcel whose own diff reaches property runners runs exactly those
    Given a fixture repository whose parcel commit changes "<changed>" on top of main
    When the QA gather runs for that parcel commit
    Then the property_runners row ran
    And the front-end named exactly the runners <reached>
    And it did not name any other runner

    Examples:
      | changed                          | reached |
      | swarmforge/scripts/a.bb         | x       |
      | swarmforge/scripts/c.sh         | y       |
      | swarmforge/scripts/test/z_property_runner.bb | z |

  # BL-2073 a-parcel-that-reaches-none-runs-nothing-02
  Scenario: a parcel whose own diff reaches no property runner runs nothing
    Given a fixture repository whose parcel commit changes "docs/how-to/note.md" on top of main
    When the QA gather runs for that parcel commit
    Then the property_runners row ran
    And it printed "no property runner reached since" and named no runner
    And it exited 0

  # BL-2073 an-unresolvable-merge-base-blocks-the-row-03
  Scenario: a parcel whose merge-base with main cannot be resolved blocks the row
    Given a fixture repository whose parcel commit has no merge-base with main
    When the QA gather runs for that parcel commit
    Then the property_runners row reads blocked, naming the failed merge-base
    And no front-end command was started
