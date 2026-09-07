Feature: BL-1464 BL-1297's merge-only fixture merges the parcel's own content, so its scenario tests what it says

  BL-1297's third scenario says a parcel whose only attributed commit is a
  merge still has content to replay. Its handler builds that parcel by
  authoring both the merged side branch and the receiving trunk under a
  foreign ticket id, BL-9999-other, and then merging under the task's
  subject. When it was written that shape reached the replay with the
  merge's delivered paths; since BL-1389 (2026-09-04) a path owned solely
  by an unlanded sibling never rides another ticket's land, so every
  delivered path is excluded and BL-1343's guard refuses - "nothing of
  this ticket's own contribution to land" - which for THAT fixture is the
  right answer. The scenario is not wrong; its fixture no longer builds
  what the scenario describes. After this parcel the merged content is the
  parcel's own, the scenario is green for the reason it states, and the
  old shape is kept as an explicit refusal case.

  # BL-1464 the-bl1297-feature-passes-on-main-01
  Scenario: the BL-1297 feature passes on main
    When the BL-1297 feature runs from the repository
    Then all six of its scenarios pass

  # BL-1464 the-merged-content-is-the-parcels-or-nobodys-02
  Scenario: the merge-only fixture's merged content is credited to the parcel or to nobody, never to a sibling
    Given the fixture repository BL-1297's third scenario builds
    When the land step attributes the tip's delivered paths
    Then no delivered path is owned solely by an unlanded sibling

  # BL-1464 a-merge-of-a-siblings-content-alone-is-still-refused-03
  Scenario: a merge whose every delivered path belongs to an unlanded sibling is still refused
    Given a fixture repository whose parcel's only attributed commit merges content authored under an unlanded sibling's id
    When the land step plans the parcel's tip
    Then it escalates saying nothing of the ticket's own contribution is left to land

  # BL-1464 the-register-row-leaves-with-the-fix-04
  Scenario: the register row leaves with the fix
    When the fix is on main
    Then backlog/standing-reds.tsv carries no row for BL-1297's feature file
