Feature: BL-2094 QA's gather diffs the parcel against its merge-base with main, so the property runners its change reaches run

  BL-2073 gave QA's gather a property_runners row meant to run
  run_property_runners.sh --changed-from <the parcel's merge-base with
  main>. The row shipped passing the gathered commit itself. QA gathers
  with that commit checked out as HEAD, so the front-end diffed
  <commit>...HEAD, an empty range, and all 15 gathers from 2026-10-08 to
  2026-10-09 printed "no property runner reached since" their own tip.
  BL-2073's acceptance drove a fake runner that never ran git, and it
  asserted the very argument that made the row empty. This feature runs the
  real row against a real repository whose HEAD is the parcel commit, the
  shape QA gathers in. It retires BL-2073's feature.

  Background:
    Given a fixture repository holding the property-runner front-end, its reach selector, and runners x and y, where runner x reaches a.bb and runner y reaches c.sh

  # BL-2094 property-runner-row-runs-what-the-parcel-reaches-01
  Scenario Outline: a parcel checked out at its own tip runs exactly the runners its change reaches
    Given the checked-out HEAD is a parcel commit on top of main that changes <changed>
    When the QA gather runs its property_runners row for HEAD
    Then the front-end was given the merge-base of main and HEAD
    And the runners that ran are <ran>

    Examples:
      | changed             | ran  |
      | a.bb                | x    |
      | docs/how-to/note.md | none |

  # BL-2094 property-runner-row-ignores-what-main-gained-02
  Scenario: a change main gained after the parcel branched runs no runner
    Given the checked-out HEAD is a parcel commit on top of main that changes a.bb
    And main has since gained a commit that changes c.sh
    When the QA gather runs its property_runners row for HEAD
    Then the runners that ran are x

  # BL-2094 property-runner-row-blocks-without-a-merge-base-03
  Scenario: a parcel that shares no history with main blocks the row
    Given the checked-out HEAD is a commit on an orphan branch that shares no history with main
    When the QA gather runs its property_runners row for HEAD
    Then the property_runners row reads blocked, naming the failed merge-base
    And the front-end was not started
